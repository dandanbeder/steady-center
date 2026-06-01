/**
 * Server-side AI budget enforcement and usage tracking.
 * Import only from server functions (createServerFn handlers).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Rough $/M token pricing (input + output averaged for simplicity)
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

export async function getUserAiBudget(userId: string): Promise<{ cap_cents: number; used_cents: number }> {
  const [prefsRes, usageRes] = await Promise.all([
    supabaseAdmin.from("ai_prefs").select("monthly_cap_cents").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("ai_usage")
      .select("cents")
      .eq("user_id", userId)
      .eq("month", monthKey())
      .maybeSingle(),
  ]);
  return {
    cap_cents: prefsRes.data?.monthly_cap_cents ?? 1000,
    used_cents: usageRes.data?.cents ?? 0,
  };
}

/** Throws if the user has already exceeded their monthly AI cap. Call BEFORE invoking the model. */
export async function assertAiBudget(userId: string): Promise<void> {
  const { cap_cents, used_cents } = await getUserAiBudget(userId);
  if (used_cents >= cap_cents) {
    throw new Error(
      `Monthly AI spend cap reached ($${(cap_cents / 100).toFixed(2)}). Increase it in Settings → AI preferences.`,
    );
  }
}

/** Record AI usage after a successful call. */
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
    .select("id, cents, tokens")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("ai_usage")
      .update({ cents: existing.cents + cents, tokens: existing.tokens + tokens })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("ai_usage").insert({ user_id: userId, month, cents, tokens });
  }
}
