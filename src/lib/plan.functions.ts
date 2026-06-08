import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserPlanContext } from "./entitlements.server";
import { getUserAiBudget } from "./ai-budget.server";

export const getMyPlanContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const [plan, budget] = await Promise.all([
      getUserPlanContext(userId),
      getUserAiBudget(userId),
    ]);
    return {
      tier: plan.tier,
      quantity: plan.quantity,
      billingCycle: plan.billingCycle,
      paidSeats: plan.paidSeats,
      trialEnd: plan.trialEnd,
      aiCap: plan.aiCap,
      aiUsed: plan.aiUsed,
      aiSpendCapCents: budget.cap_cents,
      aiSpendUsedCents: budget.used_cents,
    };
  });
