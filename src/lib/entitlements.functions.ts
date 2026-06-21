import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { effectiveLimits, LIMITS, type Tier } from "./entitlements";
import { getUserPlanContext } from "./entitlements.server";

/**
 * Unified account entitlement read.
 * Every "what is this account allowed to do?" check should go through this
 * (or the shared `effectiveLimits()` / `LIMITS` map it composes), so plan
 * rules live in exactly one place.
 *
 * - An account reads only its own entitlement (default).
 * - Super admins may pass an explicit `accountUserId` to read any account.
 * - Pure read, RLS-safe: uses `requireSupabaseAuth` for identity + the
 *   `account_credits` table (RLS already scopes self vs. super admin).
 */
export const getAccountEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ accountUserId: z.string().uuid().optional() }).optional().parse,
  )
  .handler(async ({ data, context }) => {
    const callerId = context.userId;
    let targetId = data?.accountUserId ?? callerId;

    // If caller asks for someone else, verify super admin.
    if (targetId !== callerId) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("platform_role")
        .eq("id", callerId)
        .maybeSingle();
      if (prof?.platform_role !== "superadmin") {
        throw new Error("Forbidden");
      }
    }

    const plan = await getUserPlanContext(targetId);
    const tier: Tier = plan.tier;
    const limits = effectiveLimits(tier, plan.paidSeats);

    // RLS handles self-vs-admin; just read.
    const { data: credits } = await context.supabase
      .from("account_credits")
      .select(
        "allowance_credits, credit_balance, current_cycle_start, current_cycle_end",
      )
      .eq("account_user_id", targetId)
      .maybeSingle();

    // Account status derived from the same plan resolution that powers gating.
    // free=no sub; trialing/active/past_due/canceled mirror Paddle's status.
    const status: "free" | "trialing" | "active" | "past_due" | "canceled" =
      tier === "free" ? "free" : plan.trialEnd ? "trialing" : "active";

    return {
      accountUserId: targetId,
      plan: tier,
      status,
      seatCount: plan.paidSeats,
      billingCycle: plan.billingCycle,
      currentCycleStart: credits?.current_cycle_start ?? null,
      currentCycleEnd: credits?.current_cycle_end ?? null,
      allowanceCredits: credits?.allowance_credits ?? limits.aiAllowanceCredits,
      creditBalance: credits?.credit_balance ?? 0,
      // Limits, sourced from the single LIMITS map.
      limits: {
        maxBusinesses: limits.maxBusinesses,
        maxCalendarConnections: limits.maxCalendarConnections,
        aiAllowanceCredits: limits.aiAllowanceCredits,
        canTopup: limits.canTopup,
        sharingEnabled: limits.sharingEnabled,
        teamFeaturesEnabled: limits.teamFeaturesEnabled,
      },
      // Raw plan map exposed for callers that need to render comparisons.
      planRules: LIMITS[tier],
    };
  });
