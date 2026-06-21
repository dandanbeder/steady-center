import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { gatewayFetch, getPaddleClient, type PaddleEnv } from "@/lib/paddle.server";

/**
 * Subscription management, all writes route through Paddle, the webhook then
 * reconciles the local row. NEVER mutate the subscriptions table from here:
 * Paddle is the source of truth so we can't drift if a webhook is missed.
 */

const EnvSchema = z.enum(["sandbox", "live"]);

async function loadOwnSub(userId: string, env: PaddleEnv) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No active subscription found");
  return data;
}

async function resolvePaddlePriceId(env: PaddleEnv, externalId: string): Promise<string> {
  const res = await gatewayFetch(env, `/prices?external_id=${encodeURIComponent(externalId)}`);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  if (!json.data?.length) throw new Error(`Paddle price not found: ${externalId}`);
  return json.data[0].id;
}

/** Increase or decrease the seat count on an existing Team subscription with proration. */
export const updateSeats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      environment: EnvSchema,
      delta: z.number().int().min(-50).max(50),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const sub = await loadOwnSub(userId, data.environment);
    if (sub.product_id !== "team_plan") {
      throw new Error("Seat changes only apply to Team subscriptions");
    }
    const current = (sub.quantity as number) ?? 2;
    const next = Math.max(2, Math.min(1000, current + data.delta));
    if (next === current) return { quantity: current, unchanged: true };

    const paddle = getPaddleClient(data.environment);
    const remote = await paddle.subscriptions.get(sub.paddle_subscription_id as string);
    const items = remote.items.map((it) => ({
      priceId: it.price!.id,
      quantity: next,
    }));
    await paddle.subscriptions.update(sub.paddle_subscription_id as string, {
      items,
      // Charge or credit immediately on increase; on decrease use do_not_bill so
      // credit applies at the next renewal instead of generating a tiny refund.
      prorationBillingMode:
        data.delta > 0 ? "prorated_immediately" : "do_not_bill",
    });
    // DB row will sync via subscription.updated webhook.
    return { quantity: next, unchanged: false };
  });

/** Switch a Pro or Team subscription between monthly and annual billing. */
export const switchBillingCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      environment: EnvSchema,
      cycle: z.enum(["month", "year"]),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const sub = await loadOwnSub(userId, data.environment);
    if (sub.billing_cycle === data.cycle) {
      return { changed: false, cycle: data.cycle };
    }
    const base =
      sub.product_id === "team_plan" ? "team" : sub.product_id === "pro_plan" ? "pro" : null;
    if (!base) throw new Error("Cannot switch billing cycle on this plan");
    const externalId = `${base}_${data.cycle === "year" ? "yearly" : "monthly"}`;
    const paddlePriceId = await resolvePaddlePriceId(data.environment, externalId);

    const paddle = getPaddleClient(data.environment);
    const qty = (sub.quantity as number) ?? 1;
    await paddle.subscriptions.update(sub.paddle_subscription_id as string, {
      items: [{ priceId: paddlePriceId, quantity: qty }],
      prorationBillingMode: "prorated_immediately",
    });
    return { changed: true, cycle: data.cycle };
  });

/** Cancel at period end (user keeps access until current_period_end). */
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ environment: EnvSchema }).parse)
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const sub = await loadOwnSub(userId, data.environment);
    const paddle = getPaddleClient(data.environment);
    await paddle.subscriptions.cancel(sub.paddle_subscription_id as string, {
      effectiveFrom: "next_billing_period",
    });
    return { ok: true };
  });

/** Resume a subscription that's scheduled to cancel. */
export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ environment: EnvSchema }).parse)
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const sub = await loadOwnSub(userId, data.environment);
    // Paddle accepts an empty scheduled_change reset via gateway fetch since
    // the SDK doesn't expose an explicit resume helper.
    const res = await gatewayFetch(
      data.environment,
      `/subscriptions/${sub.paddle_subscription_id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ scheduled_change: null }),
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Paddle resume failed: ${txt}`);
    }
    return { ok: true };
  });

/** Counts: paid seats used vs purchased, plus free collaborators (viewer/commenter). */
export const getSeatSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ environment: EnvSchema }).parse)
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const { data: businesses } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("owner_id", userId);
    const bizIds = (businesses ?? []).map((b: any) => b.id);

    let paidUsed = 0;
    let freeUsed = 0;
    if (bizIds.length) {
      const { data: members } = await supabaseAdmin
        .from("memberships")
        .select("role")
        .in("business_id", bizIds)
        .eq("status", "active");
      for (const m of members ?? []) {
        const role = (m as any).role as string;
        if (["owner", "admin", "member"].includes(role)) paidUsed += 1;
        else if (["viewer", "commenter"].includes(role)) freeUsed += 1;
      }
    }

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("quantity, product_id, billing_cycle, status, current_period_end, cancel_at_period_end, past_due_since")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const purchased = (sub?.quantity as number | undefined) ?? 0;
    return {
      paidUsed,
      paidPurchased: sub?.product_id === "team_plan" ? purchased : sub?.product_id === "pro_plan" ? 1 : 0,
      freeUsed,
      billingCycle: (sub?.billing_cycle as "month" | "year" | undefined) ?? "month",
      status: (sub?.status as string | undefined) ?? "none",
      currentPeriodEnd: (sub?.current_period_end as string | null) ?? null,
      cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
      pastDueSince: (sub?.past_due_since as string | null) ?? null,
      productId: (sub?.product_id as string | undefined) ?? null,
    };
  });
