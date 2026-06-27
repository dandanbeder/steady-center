import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Start a 7-day free Team trial. No card required.
 *
 * - Trials are Team-only. Basic and Standard go straight through Paddle checkout.
 * - Sets status=trialing with full Team limits for 7 days.
 * - One trial per account, ever (per environment), enforced by
 *   `profiles.trial_used_at` and the `start_free_trial` SECURITY DEFINER fn.
 * - When a trial ends without converting, the user falls back to Free
 *   (never auto-charged, no card is captured).
 * - At conversion the user goes through the normal Paddle checkout and the
 *   webhook upserts a new subscription row with status='active'.
 */
export const startFreeTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      plan: z.literal("team"),
      environment: z.enum(["sandbox", "live"]),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("start_free_trial", {
      _plan: data.plan,
      _env: data.environment,
    });
    if (error) {
      const msg = error.message || "Could not start trial";
      if (/TRIAL_ALREADY_USED/.test(msg)) {
        throw new Error("You've already used your free trial.");
      }
      if (/TRIAL_NOT_AVAILABLE/.test(msg)) {
        throw new Error("You already have an active subscription.");
      }
      throw new Error(msg);
    }
    return { ok: true, subscription: row };
  });

/** Read whether the caller is eligible to start a trial in this env. */
export const getTrialEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ environment: z.enum(["sandbox", "live"]) }).parse)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("trial_used_at, trial_used_env, trial_plan")
      .eq("id", context.userId)
      .maybeSingle();
    const used =
      !!prof?.trial_used_at && prof?.trial_used_env === data.environment;
    return {
      eligible: !used,
      trialUsedAt: prof?.trial_used_at ?? null,
      trialPlan: prof?.trial_plan ?? null,
    };
  });
