/**
 * Server-side AI budget enforcement and usage tracking.
 * Import only from server functions (createServerFn handlers).
 *
 * Two limits gate every AI call:
 *  1. Plan-level monthly action cap (Free=20, Pro=400, Team=400×seats).
 *  2. User-set $ cap from ai_prefs (defense against runaway model cost).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getUserPlanContext, requireAiAction } from "./entitlements.server";
import { UPGRADE_REQUIRED_PREFIX } from "./entitlements";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-sonnet-4-20250514": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 0.8, out: 4 },
  "claude-haiku-3-5": { in: 0.25, out: 1.25 },
};

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-5"];
  const dollars = (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
  return Math.ceil(dollars * 100);
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

/** Record AI usage after a successful call. Also increments the plan-level action counter. */
export async function recordAiUsage(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const cents = estimateCostCents(model, inputTokens, outputTokens);
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
        cents: existing.cents + cents,
        tokens: existing.tokens + tokens,
        actions: ((existing.actions as number | null) ?? 0) + 1,
      })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin
      .from("ai_usage")
      .insert({ user_id: userId, month, cents, tokens, actions: 1 });
  }
}
