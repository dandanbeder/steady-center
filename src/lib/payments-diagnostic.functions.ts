import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

async function requireSuperadmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.platform_role !== "superadmin") {
    throw new Error("Not authorized");
  }
}

export type WebhookNotification = {
  id: string;
  event_type: string;
  status: string;
  occurred_at: string;
  delivered_at: string | null;
  attempts: number;
  last_attempt_status: string | null;
  payload_summary: string;
};

export const listPaddleWebhooks = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((d: { environment: PaddleEnv }) =>
    z.object({ environment: z.enum(["sandbox", "live"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireSuperadmin(context.userId);
    const res = await gatewayFetch(
      data.environment,
      `/notifications?per_page=20&order_by=occurred_at[DESC]`,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Paddle API ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { data: any[] };
    const items: WebhookNotification[] = (json.data ?? []).map((n) => {
      const ev = n.payload ?? {};
      const d = ev.data ?? {};
      const subId = d.id || d.subscription_id || "";
      const status = d.status ? ` status=${d.status}` : "";
      return {
        id: n.id,
        event_type: ev.event_type || n.type || "",
        status: n.status,
        occurred_at: n.occurred_at,
        delivered_at: n.delivered_at ?? null,
        attempts: n.times_attempted ?? 0,
        last_attempt_status: n.last_attempt?.status ?? null,
        payload_summary: subId ? `${subId}${status}` : status.trim(),
      };
    });
    return items;
  });

export type SubscriptionRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  paddle_subscription_id: string;
  product_id: string;
  price_id: string;
  status: string;
  quantity: number | null;
  billing_cycle: string | null;
  environment: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  past_due_since: string | null;
  trial_end: string | null;
  updated_at: string;
  created_at: string;
};

export const listSubscriptionRows = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((d: { environment: PaddleEnv }) =>
    z.object({ environment: z.enum(["sandbox", "live"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<SubscriptionRow[]> => {
    await requireSuperadmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("environment", data.environment)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    let emailMap = new Map<string, string>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      emailMap = new Map((profs ?? []).map((p: any) => [p.id, p.email]));
    }

    return (rows ?? []).map((r: any) => ({
      ...r,
      user_email: emailMap.get(r.user_id) ?? null,
    })) as SubscriptionRow[];
  });
