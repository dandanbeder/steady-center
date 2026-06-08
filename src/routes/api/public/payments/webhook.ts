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

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;

  const userId = customData?.userId;
  if (!userId) {
    console.error("[payments-webhook] No userId in customData");
    return;
  }

  const item = items[0];
  const priceId = item.price.importMeta?.externalId;
  const productId = item.product.importMeta?.externalId;
  if (!priceId || !productId) {
    console.warn("[payments-webhook] Skipping subscription: missing importMeta.externalId", {
      rawPriceId: item.price.id,
      rawProductId: item.product.id,
    });
    return;
  }
  const quantity = Number(item.quantity ?? 1);
  const billingCycle = item.price?.billingCycle?.interval === "year" ? "year" : "month";
  const trialEnd = data.startedAt && data.firstBilledAt && data.startedAt !== data.firstBilledAt
    ? data.firstBilledAt
    : null;

  await getSupabase().from("subscriptions").upsert(
    {
      user_id: userId,
      paddle_subscription_id: id,
      paddle_customer_id: customerId,
      product_id: productId,
      price_id: priceId,
      status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      quantity,
      billing_cycle: billingCycle,
      trial_end: trialEnd,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "paddle_subscription_id" },
  );
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange, items } = data;

  const item = items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const productId = item?.product?.importMeta?.externalId;
  const quantity = item?.quantity != null ? Number(item.quantity) : undefined;
  const billingCycle = item?.price?.billingCycle?.interval === "year" ? "year" : item?.price?.billingCycle?.interval === "month" ? "month" : undefined;

  const update: Record<string, unknown> = {
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    cancel_at_period_end: scheduledChange?.action === "cancel",
    updated_at: new Date().toISOString(),
  };
  if (priceId) update.price_id = priceId;
  if (productId) update.product_id = productId;
  if (quantity != null) update.quantity = quantity;
  if (billingCycle) update.billing_cycle = billingCycle;

  await getSupabase()
    .from("subscriptions")
    .update(update)
    .eq("paddle_subscription_id", id)
    .eq("environment", env);
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const supabase = getSupabase();
  await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      current_period_end: data.currentBillingPeriod?.endsAt,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);

  // Apply read-only to extras when the period actually ends; for now we flag
  // immediately on cancel so the user sees what will become read-only.
  const userId = data.customData?.userId as string | undefined;
  if (!userId) return;
  await applyDowngradeReadonly(userId);
}

async function applyDowngradeReadonly(userId: string) {
  const supabase = getSupabase();
  // Keep the oldest 1 business + 1 calendar live; mark rest as read_only.
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  const keepBiz = (businesses ?? []).slice(0, 1).map((b: any) => b.id);
  const dropBiz = (businesses ?? []).slice(1).map((b: any) => b.id);
  if (dropBiz.length) {
    await supabase.from("businesses").update({ read_only: true }).in("id", dropBiz);
  }
  if (keepBiz.length) {
    await supabase.from("businesses").update({ read_only: false }).in("id", keepBiz);
  }

  const { data: cals } = await supabase
    .from("calendars")
    .select("id, provider")
    .eq("owner_id", userId)
    .neq("provider", "manual")
    .order("created_at", { ascending: true });
  const keepCal = (cals ?? []).slice(0, 1).map((c: any) => c.id);
  const dropCal = (cals ?? []).slice(1).map((c: any) => c.id);
  if (dropCal.length) {
    await supabase.from("calendars").update({ read_only: true }).in("id", dropCal);
  }
  if (keepCal.length) {
    await supabase.from("calendars").update({ read_only: false }).in("id", keepCal);
  }
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.eventType) {
    case EventName.SubscriptionCreated:
      await handleSubscriptionCreated(event.data, env);
      break;
    case EventName.SubscriptionUpdated:
      await handleSubscriptionUpdated(event.data, env);
      break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env);
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
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
