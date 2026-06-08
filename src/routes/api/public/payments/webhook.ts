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

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, status, currentBillingPeriod, customData } = data;
  const userId = customData?.userId as string | undefined;
  if (!userId) {
    console.error("[payments-webhook] No userId in customData");
    return;
  }
  const { priceId, productId, quantity, billingCycle } = extractItem(data);
  if (!priceId || !productId) {
    console.warn("[payments-webhook] Skipping subscription: missing importMeta.externalId");
    return;
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
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange } = data;
  const { priceId, productId, quantity, billingCycle } = extractItem(data);
  const supabase = getSupabase();

  // past_due_since: stamp when first entering past_due, clear when leaving it.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("status, past_due_since")
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
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

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

  const userId = (row?.user_id as string | undefined) ?? (data.customData?.userId as string | undefined);
  if (userId) await applyDowngradeReadonly(userId);
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
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const subId = data.subscriptionId as string | undefined;
  if (!subId) return;
  // A successful charge clears past_due flags. Status stays whatever Paddle says
  // it is via subscription.updated, but we clear the grace counter eagerly.
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

async function applyDowngradeReadonly(userId: string) {
  const supabase = getSupabase();
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  const keepBiz = (businesses ?? []).slice(0, 1).map((b: any) => b.id);
  const dropBiz = (businesses ?? []).slice(1).map((b: any) => b.id);
  if (dropBiz.length) await supabase.from("businesses").update({ read_only: true }).in("id", dropBiz);
  if (keepBiz.length) await supabase.from("businesses").update({ read_only: false }).in("id", keepBiz);

  const { data: cals } = await supabase
    .from("calendars")
    .select("id")
    .eq("owner_id", userId)
    .neq("provider", "manual")
    .order("created_at", { ascending: true });
  const keepCal = (cals ?? []).slice(0, 1).map((c: any) => c.id);
  const dropCal = (cals ?? []).slice(1).map((c: any) => c.id);
  if (dropCal.length) await supabase.from("calendars").update({ read_only: true }).in("id", dropCal);
  if (keepCal.length) await supabase.from("calendars").update({ read_only: false }).in("id", keepCal);
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
