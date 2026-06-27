import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserPlanContext } from "./entitlements.server";

export const getMyPlanContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const plan = await getUserPlanContext(userId);
    // Note: USD spend cap / used cents are deliberately omitted, internal
    // economics must not be exposed to the client. Users see credits only.
    return {
      tier: plan.tier,
      quantity: plan.quantity,
      billingCycle: plan.billingCycle,
      paidSeats: plan.paidSeats,
      trialEnd: plan.trialEnd,
      aiCap: plan.aiCap,
      aiUsed: plan.aiUsed,
    };
  });
