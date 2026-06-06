import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasFeature,
  requiredTierFor,
  tierLabel,
  UPGRADE_REQUIRED_PREFIX,
  type Feature,
  type Tier,
} from "./entitlements";

function paddleEnvFromBuild(): "sandbox" | "live" {
  // Vite inlines VITE_* at build time on both client and server bundles.
  const token = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
  return token?.startsWith("test_") ? "sandbox" : "live";
}

export async function getUserTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<Tier> {
  const env = paddleEnvFromBuild();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, product_id, current_period_end")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return "free";

  const periodEnd = data.current_period_end
    ? new Date(data.current_period_end as string)
    : null;
  const inPeriod = !periodEnd || periodEnd > new Date();
  const active =
    (["active", "trialing", "past_due"].includes(data.status as string) &&
      inPeriod) ||
    (data.status === "canceled" && !!periodEnd && periodEnd > new Date());
  if (!active) return "free";
  if (data.product_id === "team_plan") return "team";
  if (data.product_id === "pro_plan") return "pro";
  return "free";
}

export async function requireFeature(
  supabase: SupabaseClient,
  userId: string,
  feature: Feature,
): Promise<Tier> {
  const tier = await getUserTier(supabase, userId);
  if (!hasFeature(tier, feature)) {
    const required = requiredTierFor(feature);
    throw new Error(
      `${UPGRADE_REQUIRED_PREFIX} ${tierLabel(required)} plan required for this feature.`,
    );
  }
  return tier;
}
