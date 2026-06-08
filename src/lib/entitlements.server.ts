import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  effectiveLimits,
  hasFeature,
  isPaidRole,
  LIMITS,
  requiredTierFor,
  tierLabel,
  UPGRADE_REQUIRED_PREFIX,
  type BillingCycle,
  type Feature,
  type Tier,
} from "./entitlements";

function paddleEnvFromBuild(): "sandbox" | "live" {
  const token = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
  return token?.startsWith("test_") ? "sandbox" : "live";
}

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type PlanContext = {
  tier: Tier;
  quantity: number;
  billingCycle: BillingCycle;
  paidSeats: number;
  trialEnd: string | null;
  aiCap: number;
  aiUsed: number;
};

/** Resolve the user's effective plan + AI usage for the current month. */
export async function getUserPlanContext(userId: string): Promise<PlanContext> {
  const env = paddleEnvFromBuild();
  const [{ data: sub }, { data: usage }] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("status, product_id, current_period_end, quantity, billing_cycle, trial_end")
      .eq("user_id", userId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("ai_usage")
      .select("actions")
      .eq("user_id", userId)
      .eq("month", monthKey())
      .maybeSingle(),
  ]);

  const now = new Date();
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end as string) : null;
  const trialEnd = sub?.trial_end ? new Date(sub.trial_end as string) : null;
  const inPeriod = !periodEnd || periodEnd > now;
  const active =
    !!sub &&
    ((["active", "trialing", "past_due"].includes(sub.status as string) && inPeriod) ||
      (sub.status === "canceled" && !!periodEnd && periodEnd > now));
  const trialing = !!trialEnd && trialEnd > now;

  let tier: Tier = "free";
  if (active && sub?.product_id === "team_plan") tier = "team";
  else if (active && sub?.product_id === "pro_plan") tier = "pro";
  else if (trialing) tier = "pro";

  const quantity = (sub?.quantity as number | undefined) ?? 1;
  const billingCycle = ((sub?.billing_cycle as BillingCycle | undefined) ?? "month") as BillingCycle;
  const paidSeats = tier === "team" ? Math.max(quantity, 2) : 1;
  const limits = effectiveLimits(tier, paidSeats);

  return {
    tier,
    quantity,
    billingCycle,
    paidSeats,
    trialEnd: trialEnd ? trialEnd.toISOString() : null,
    aiCap: limits.aiActionsCap,
    aiUsed: (usage?.actions as number | undefined) ?? 0,
  };
}

export async function requireFeature(
  _supabase: SupabaseClient,
  userId: string,
  feature: Feature,
): Promise<Tier> {
  const { tier } = await getUserPlanContext(userId);
  if (!hasFeature(tier, feature)) {
    const required = requiredTierFor(feature);
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} ${tierLabel(required)} plan required for this feature.`,
    );
  }
  return tier;
}

/** Throws UPGRADE_REQUIRED if the user has hit their account (business) limit. */
export async function requireAccountSlot(userId: string): Promise<void> {
  const { tier } = await getUserPlanContext(userId);
  const cap = LIMITS[tier].accounts;
  if (cap < 0) return;
  const { count } = await supabaseAdmin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if ((count ?? 0) >= cap) {
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} Free plan allows ${cap} account. Upgrade to add more.`,
    );
  }
}

/** Throws UPGRADE_REQUIRED if the user has hit their connected-calendar limit. */
export async function requireCalendarSlot(userId: string): Promise<void> {
  const { tier } = await getUserPlanContext(userId);
  const cap = LIMITS[tier].calendarConnections;
  if (cap < 0) return;
  const { count } = await supabaseAdmin
    .from("calendars")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .neq("provider", "manual");
  if ((count ?? 0) >= cap) {
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} Free plan allows ${cap} calendar connection. Upgrade to add more.`,
    );
  }
}

/** Throws UPGRADE_REQUIRED if the user has used all AI actions this month. */
export async function requireAiAction(userId: string): Promise<PlanContext> {
  const ctx = await getUserPlanContext(userId);
  if (ctx.aiUsed >= ctx.aiCap) {
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} You've used all ${ctx.aiCap} AI actions for this month.`,
    );
  }
  return ctx;
}

/** Increment the AI action counter for this user this month. Safe to fire-and-forget. */
export async function recordAiAction(userId: string, count = 1): Promise<void> {
  const month = monthKey();
  const { data: existing } = await supabaseAdmin
    .from("ai_usage")
    .select("id, actions")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("ai_usage")
      .update({ actions: ((existing.actions as number) ?? 0) + count })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin
      .from("ai_usage")
      .insert({ user_id: userId, month, actions: count });
  }
}

/** Re-export for callers that want to check role classification server-side. */
export { isPaidRole };
