/**
 * Server-side AI budget enforcement and usage tracking.
 * Import only from server functions (createServerFn handlers).
 *
 * Two limits gate every AI call:
 *  1. Plan-level monthly action cap (Free=20, Pro=400, Team=400×seats).
 *  2. User-set $ cap from ai_prefs (defense against runaway model cost).
 *
 * Every successful AI call also writes a per-event row into ai_usage_events
 * (metadata only, never prompt/response content). That ledger is the
 * measurement spine used to calibrate credit pricing later.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getUserPlanContext, requireAiAction } from "./entitlements.server";
import { UPGRADE_REQUIRED_PREFIX } from "./entitlements";
import type { AiActionType } from "./credits-types";
export type { AiActionType } from "./credits-types";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pricing config, single source of truth.
// All values in micro-USD ($1 = 1_000_000). Update here when prices change.
// ---------------------------------------------------------------------------

type TextRate = { inPerMtok: number; outPerMtok: number };
type AudioRate = { perSecond: number };

const TEXT_PRICING: Record<string, TextRate> = {
  // Anthropic
  "claude-sonnet-4-5": { inPerMtok: 3_000_000, outPerMtok: 15_000_000 },
  "claude-sonnet-4-20250514": { inPerMtok: 3_000_000, outPerMtok: 15_000_000 },
  "claude-haiku-4-5": { inPerMtok: 800_000, outPerMtok: 4_000_000 },
  "claude-haiku-3-5": { inPerMtok: 250_000, outPerMtok: 1_250_000 },
  // Lovable AI Gateway, Google
  "google/gemini-3-flash-preview": { inPerMtok: 300_000, outPerMtok: 2_500_000 },
  "google/gemini-3.1-flash-lite": { inPerMtok: 100_000, outPerMtok: 400_000 },
  "google/gemini-2.5-flash": { inPerMtok: 300_000, outPerMtok: 2_500_000 },
  "google/gemini-2.5-flash-lite": { inPerMtok: 100_000, outPerMtok: 400_000 },
  "google/gemini-2.5-pro": { inPerMtok: 1_250_000, outPerMtok: 10_000_000 },
  // Lovable AI Gateway, OpenAI
  "openai/gpt-5": { inPerMtok: 2_500_000, outPerMtok: 10_000_000 },
  "openai/gpt-5-mini": { inPerMtok: 250_000, outPerMtok: 2_000_000 },
  "openai/gpt-5-nano": { inPerMtok: 50_000, outPerMtok: 400_000 },
};

const AUDIO_PRICING: Record<string, AudioRate> = {
  // gpt-4o-mini-transcribe ≈ $0.003/min ≈ 50 micro-USD/sec
  "openai/gpt-4o-mini-transcribe": { perSecond: 50 },
  "openai/gpt-4o-transcribe": { perSecond: 100 },
};

// Fallback for unknown text models: bias high so unknowns are visible
// in the ledger rather than silently free.
const FALLBACK_TEXT: TextRate = { inPerMtok: 3_000_000, outPerMtok: 15_000_000 };
const FALLBACK_AUDIO: AudioRate = { perSecond: 50 };

const warnedMissing = new Set<string>();
function warnOnce(model: string, kind: "text" | "audio") {
  const k = `${kind}:${model}`;
  if (warnedMissing.has(k)) return;
  warnedMissing.add(k);
  console.warn(`[ai-usage] no ${kind} pricing for model "${model}"; using fallback`);
}

export function trueCostMicros(opts: {
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  audioSeconds?: number;
}): number {
  const tokensIn = opts.tokensIn ?? 0;
  const tokensOut = opts.tokensOut ?? 0;
  const audioSeconds = opts.audioSeconds ?? 0;
  let micros = 0;
  if (tokensIn > 0 || tokensOut > 0) {
    const rate = TEXT_PRICING[opts.model];
    if (!rate) warnOnce(opts.model, "text");
    const r = rate ?? FALLBACK_TEXT;
    micros += Math.round((tokensIn * r.inPerMtok) / 1_000_000);
    micros += Math.round((tokensOut * r.outPerMtok) / 1_000_000);
  }
  if (audioSeconds > 0) {
    const rate = AUDIO_PRICING[opts.model];
    if (!rate) warnOnce(opts.model, "audio");
    const r = rate ?? FALLBACK_AUDIO;
    micros += Math.round(audioSeconds * r.perSecond);
  }
  return micros;
}

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const micros = trueCostMicros({ model, tokensIn: inputTokens, tokensOut: outputTokens });
  // 1 cent = 10_000 micro-USD
  return Math.ceil(micros / 10_000);
}

export async function getUserAiBudget(userId: string): Promise<{
  cap_cents: number;
  used_cents: number;
  actions_cap: number;
  actions_used: number;
  tier: string;
}> {
  const [prefsRes, usageRes, plan] = await Promise.all([
    supabaseAdmin.from("ai_prefs").select("monthly_cap_cents").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("ai_usage")
      .select("cents")
      .eq("user_id", userId)
      .eq("month", monthKey())
      .maybeSingle(),
    getUserPlanContext(userId),
  ]);
  return {
    cap_cents: prefsRes.data?.monthly_cap_cents ?? 1000,
    used_cents: usageRes.data?.cents ?? 0,
    actions_cap: plan.aiCap,
    actions_used: plan.aiUsed,
    tier: plan.tier,
  };
}

/** Throws if the user has hit either the plan action cap or the $ cap. Call BEFORE invoking the model. */
export async function assertAiBudget(userId: string): Promise<void> {
  await requireAiAction(userId);
  const { cap_cents, used_cents } = await getUserAiBudget(userId);
  if (used_cents >= cap_cents) {
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} Monthly AI spend cap reached ($${(cap_cents / 100).toFixed(2)}). Increase it in Settings → AI preferences.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-event ledger
// ---------------------------------------------------------------------------


// Cache the user's team_id resolution so a chatty caller doesn't N+1 memberships.
const teamIdCache = new Map<string, { team_id: string | null; at: number }>();
async function resolveTeamId(userId: string): Promise<string | null> {
  const hit = teamIdCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.team_id;
  const { data } = await supabaseAdmin
    .from("memberships")
    .select("business_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const team_id = (data?.business_id as string | null) ?? null;
  teamIdCache.set(userId, { team_id, at: Date.now() });
  return team_id;
}

/**
 * Write a per-event ledger row. METADATA ONLY, never pass prompt/response text.
 * Returns the inserted row id (or null on failure). Never throws: cost logging
 * must not break the user-facing AI call.
 */
export async function logAiUsageEvent(opts: {
  userId: string;
  actionType: AiActionType;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  audioSeconds?: number;
  creditsCharged?: number;
}): Promise<string | null> {
  try {
    const tokensIn = opts.tokensIn ?? 0;
    const tokensOut = opts.tokensOut ?? 0;
    const audioSeconds = opts.audioSeconds ?? 0;
    const creditsCharged = opts.creditsCharged ?? 0;
    const true_cost_micros = trueCostMicros({
      model: opts.model,
      tokensIn,
      tokensOut,
      audioSeconds,
    });
    const team_id = await resolveTeamId(opts.userId);
    const { data, error } = await supabaseAdmin
      .from("ai_usage_events")
      .insert({
        user_id: opts.userId,
        team_id,
        action_type: opts.actionType,
        model_used: opts.model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        audio_seconds: audioSeconds,
        true_cost_micros,
        credits_charged: creditsCharged,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  } catch (e) {
    console.warn("[ai-usage] failed to write ledger event", e);
    return null;
  }
}

/**
 * Record AI usage after a successful call.
 * Writes the per-event ledger, charges cost-anchored credits via the
 * SECURITY DEFINER RPC, AND increments the monthly aggregate counter
 * (kept as legacy defence-in-depth for the user-set $ cap).
 */
export async function recordAiUsage(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  opts?: {
    actionType?: AiActionType;
    audioSeconds?: number;
  },
): Promise<void> {
  const actionType: AiActionType = opts?.actionType ?? "other";
  const audioSeconds = opts?.audioSeconds ?? 0;

  // Lazy import to keep ai-budget.server.ts free of a circular dep cycle.
  const { chargeAiCredits } = await import("./credits.server");

  // 1. Per-event ledger row.
  const eventId = await logAiUsageEvent({
    userId,
    actionType,
    model,
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    audioSeconds,
    creditsCharged: 0, // backfilled below once we know the charge
  });

  // 2. Charge cost-anchored credits.
  let creditsCharged = 0;
  try {
    creditsCharged = await chargeAiCredits({
      userId,
      actionType,
      model,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      audioSeconds,
      eventId,
    });
    if (eventId) {
      await supabaseAdmin
        .from("ai_usage_events")
        .update({ credits_charged: creditsCharged })
        .eq("id", eventId);
    }
  } catch (e) {
    console.warn("[ai-usage] credit charge failed", e);
  }

  // 3. Monthly aggregate (legacy $-cap counter).
  const cents = estimateCostCents(model, inputTokens, outputTokens);
  const audioCents = audioSeconds
    ? Math.ceil(trueCostMicros({ model, audioSeconds }) / 10_000)
    : 0;
  const totalCents = cents + audioCents;
  const tokens = inputTokens + outputTokens;
  const month = monthKey();
  const { data: existing } = await supabaseAdmin
    .from("ai_usage")
    .select("id, cents, tokens, actions")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("ai_usage")
      .update({
        cents: existing.cents + totalCents,
        tokens: existing.tokens + tokens,
        actions: ((existing.actions as number | null) ?? 0) + 1,
      })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin
      .from("ai_usage")
      .insert({ user_id: userId, month, cents: totalCents, tokens, actions: 1 });
  }
}
