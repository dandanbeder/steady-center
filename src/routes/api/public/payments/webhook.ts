import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function extractItem(data: any) {
  const item = data.items?.[0];
  const priceId = item?.price?.importMeta?.externalId as string | undefined;
  const productId = item?.product?.importMeta?.externalId as string | undefined;
  const quantity = item?.quantity != null ? Number(item.quantity) : undefined;
  const billingCycle =
    item?.price?.billingCycle?.interval === "year"
      ? "year"
      : item?.price?.billingCycle?.interval === "month"
        ? "month"
        : undefined;
  return { priceId, productId, quantity, billingCycle };
}

function planAllowanceFromProduct(productId: string | undefined, qty: number): number {
  // Mirrors LIMITS in src/lib/entitlements.ts. Kept here intentionally small —
  // webhook handler has no client/shared deps.
  if (productId === "team_plan") return 400 * Math.max(qty, 2);
  if (productId === "pro_plan") return 400;
  return 20; // free / unknown
}

async function resetCycleIfNew(
  userId: string,
  productId: string | undefined,
  quantity: number,
  periodStart: string | undefined | null,
  periodEnd: string | undefined | null,
) {
  if (!periodStart || !periodEnd) return;
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("account_credits")
    .select("current_cycle_start")
    .eq("account_user_id", userId)
    .maybeSingle();
  const same =
    existing?.current_cycle_start &&
    new Date(existing.current_cycle_start as string).getTime() ===
      new Date(periodStart).getTime();
  if (same) return;
  const allowance = planAllowanceFromProduct(productId, quantity);
  await supabase.rpc("reset_cycle_allowance", {
    _user_id: userId,
    _allowance: allowance,
    _start: periodStart,
    _end: periodEnd,
  });
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, status, currentBillingPeriod, customData } = data;
  const userId = customData?.userId as string | undefined;
  if (!userId) {
    console.error("[payments-webhook] No userId in customData");
    return;
  }
  let { priceId, productId, quantity, billingCycle } = extractItem(data);
  if (!priceId || !productId) {
    console.warn("[payments-webhook] Skipping subscription: missing importMeta.externalId");
    return;
  }
  // Team minimum: if Paddle ever delivers a team item with qty<2, demote locally.
  if (productId === "team_plan" && (quantity ?? 1) < 2) {
    productId = "pro_plan";
    quantity = 1;
  }
  const trialEnd =
    data.startedAt && data.firstBilledAt && data.startedAt !== data.firstBilledAt
      ? data.firstBilledAt
      : null;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        paddle_subscription_id: id,
        paddle_customer_id: customerId,
        product_id: productId,
        price_id: priceId,
        status,
        current_period_start: currentBillingPeriod?.startsAt,
        current_period_end: currentBillingPeriod?.endsAt,
        quantity: quantity ?? 1,
        billing_cycle: billingCycle ?? "month",
        trial_end: trialEnd,
        past_due_since: null,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "paddle_subscription_id" },
    );

  // New paid sub → fresh cycle, set allowance, leave purchased credits.
  await resetCycleIfNew(userId, productId, quantity ?? 1, currentBillingPeriod?.startsAt, currentBillingPeriod?.endsAt);
  // Re-upgraded after a previous lock? Clear read-only flags now within new cap.
  await getSupabase().rpc("clear_plan_locks", { _user_id: userId });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange } = data;
  let { priceId, productId, quantity, billingCycle } = extractItem(data);
  const supabase = getSupabase();

  // Team min enforcement: a Team sub at <2 seats becomes Pro.
  if (productId === "team_plan" && (quantity ?? 2) < 2) {
    productId = "pro_plan";
    quantity = 1;
  }

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, status, past_due_since, product_id, quantity")
    .eq("paddle_subscription_id", id)
    .eq("environment", env)
    .maybeSingle();

  let pastDueSince = existing?.past_due_since ?? null;
  if (status === "past_due" && !pastDueSince) {
    pastDueSince = new Date().toISOString();
  } else if (status !== "past_due") {
    pastDueSince = null;
  }

  const update: Record<string, unknown> = {
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    cancel_at_period_end: scheduledChange?.action === "cancel",
    past_due_since: pastDueSince,
    updated_at: new Date().toISOString(),
  };
  if (priceId) update.price_id = priceId;
  if (productId) update.product_id = productId;
  if (quantity != null) update.quantity = quantity;
  if (billingCycle) update.billing_cycle = billingCycle;

  await supabase
    .from("subscriptions")
    .update(update)
    .eq("paddle_subscription_id", id)
    .eq("environment", env);

  const userId = existing?.user_id as string | undefined;
  if (userId && (status === "active" || status === "trialing")) {
    // Allowance resets on billing anniversary; purchased credits untouched.
    await resetCycleIfNew(
      userId, productId ?? (existing?.product_id as string | undefined),
      quantity ?? (existing?.quantity as number | undefined) ?? 1,
      currentBillingPeriod?.startsAt, currentBillingPeriod?.endsAt,
    );
    // Plan change that increases caps should unlock anything previously locked.
    const planChanged = productId && existing?.product_id && productId !== existing.product_id;
    const seatsGrew = quantity != null && (quantity as number) > ((existing?.quantity as number) ?? 0);
    if (planChanged || seatsGrew) {
      await supabase.rpc("clear_plan_locks", { _user_id: userId });
    }
    // A downgrade (Team→Pro, more seats removed, etc.) may now exceed caps.
    if (planChanged || (quantity != null && (quantity as number) < ((existing?.quantity as number) ?? 0))) {
      await supabase.rpc("apply_plan_downgrade", { _user_id: userId });
    }
  }
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const supabase = getSupabase();
  // Stays active until current_period_end. Do NOT apply read-only lock now —
  // the lifecycle sweeper applies it once the period actually ends.
  await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      current_period_end: data.currentBillingPeriod?.endsAt,
      past_due_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
}

async function handleTransactionPaymentFailed(data: any, env: PaddleEnv) {
  const subId = data.subscriptionId as string | undefined;
  if (!subId) return;
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("past_due_since")
    .eq("paddle_subscription_id", subId)
    .eq("environment", env)
    .maybeSingle();
  const pastDueSince = existing?.past_due_since ?? new Date().toISOString();
  await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      past_due_since: pastDueSince,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", subId)
    .eq("environment", env);
  // Stays past_due through Paddle's retry window; sweeper drops to Free
  // only after grace expires. Never suspend or delete here.
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const subId = data.subscriptionId as string | undefined;
  if (!subId) return;
  await getSupabase()
    .from("subscriptions")
    .update({
      past_due_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", subId)
    .eq("environment", env)
    .eq("status", "past_due");
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  // verifyWebhook throws on missing/invalid Paddle-Signature → 400, rejecting
  // forged or replayed requests at the door.
  const event = await verifyWebhook(req, env);

  switch (event.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionActivated:
      await handleSubscriptionCreated(event.data, env);
      break;
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
      await handleSubscriptionUpdated(event.data, env);
      break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env);
      break;
    case EventName.TransactionPaymentFailed:
      await handleTransactionPaymentFailed(event.data, env);
      break;
    case EventName.TransactionCompleted:
      await handleTransactionCompleted(event.data, env);
      break;
    default:
      console.log("[payments-webhook] Unhandled event:", event.eventType);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
        try {
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("[payments-webhook] error:", e);
          // 400 = signature/decoding failure; Paddle will not retry forever.
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
