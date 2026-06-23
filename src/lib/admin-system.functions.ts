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
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

async function logAudit(
  adminId: string,
  targetUserId: string | null,
  action: string,
  before: unknown,
  after: unknown,
  reason: string | null,
) {
  try {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: adminId,
      target_user_id: targetUserId,
      action,
      before: (before ?? null) as never,
      after: (after ?? null) as never,
      reason: reason ?? null,
    });
  } catch (e) {
    console.error("[audit] failed", action, e);
  }
}

// ---------- Failed / pending Paddle webhooks ----------

export type FailedWebhookRow = {
  id: string;
  event_type: string;
  status: string;
  occurred_at: string;
  delivered_at: string | null;
  attempts: number;
  last_attempt_status: string | null;
  notification_setting_id: string | null;
  payload_summary: string;
  matched_subscription_user_id: string | null;
  matched_subscription_user_email: string | null;
};

export const adminListFailedWebhooks = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((d: { environment: PaddleEnv }) =>
    z.object({ environment: z.enum(["sandbox", "live"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<FailedWebhookRow[]> => {
    await requireSuperadmin(context.userId);
    // Paddle statuses: not_attempted | needs_attention | delivered | failed
    // We surface anything not delivered. needs_attention = Paddle gave up retrying.
    const res = await gatewayFetch(
      data.environment,
      `/notifications?per_page=50&order_by=occurred_at[DESC]&status=needs_attention&status=failed&status=not_attempted`,
    );
    if (!res.ok) throw new Error(`Paddle API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: any[] };
    const items = json.data ?? [];

    // Try to attribute each event to a known user by paddle_subscription_id.
    const subIds = Array.from(
      new Set(
        items
          .map((n: any) => n.payload?.data?.id || n.payload?.data?.subscription_id)
          .filter(Boolean) as string[],
      ),
    );
    const subMap = new Map<string, string>();
    if (subIds.length) {
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("paddle_subscription_id, user_id")
        .in("paddle_subscription_id", subIds);
      for (const s of subs ?? []) subMap.set(s.paddle_subscription_id, s.user_id);
    }
    const userIds = Array.from(new Set(Array.from(subMap.values())));
    const emailMap = new Map<string, string>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of users?.users ?? []) if (u.email) emailMap.set(u.id, u.email);
    }

    return items.map((n: any) => {
      const ev = n.payload ?? {};
      const d = ev.data ?? {};
      const subId = d.id || d.subscription_id || "";
      const userId = subId ? subMap.get(subId) ?? null : null;
      return {
        id: n.id,
        event_type: ev.event_type || n.type || "",
        status: n.status,
        occurred_at: n.occurred_at,
        delivered_at: n.delivered_at ?? null,
        attempts: n.times_attempted ?? 0,
        last_attempt_status: n.last_attempt?.status ?? null,
        notification_setting_id: n.notification_setting_id ?? null,
        payload_summary: subId
          ? `${subId}${d.status ? ` status=${d.status}` : ""}`
          : (d.status ? `status=${d.status}` : ""),
        matched_subscription_user_id: userId,
        matched_subscription_user_email: userId ? emailMap.get(userId) ?? null : null,
      };
    });
  });

export const adminReplayWebhook = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { notification_id: string; environment: PaddleEnv; reason: string }) =>
    z.object({
      notification_id: z.string().min(1).max(200),
      environment: z.enum(["sandbox", "live"]),
      reason: z.string().min(3).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireSuperadmin(context.userId);
    const res = await gatewayFetch(
      data.environment,
      `/notifications/${encodeURIComponent(data.notification_id)}/replay`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`Paddle replay ${res.status}: ${await res.text()}`);
    await logAudit(
      context.userId,
      null,
      "webhook.replay",
      null,
      { notification_id: data.notification_id, environment: data.environment },
      data.reason,
    );
    return { ok: true };
  });

// ---------- Platform-wide teams (businesses) ----------

export type TeamRow = {
  id: string;
  name: string;
  owner_id: string;
  owner_email: string | null;
  owner_full_name: string | null;
  member_count: number;
  active_member_count: number;
  created_at: string;
  archived_at: string | null;
  owner_plan: "free" | "pro" | "team" | "other";
  owner_plan_status: string | null;
};

export const adminListAllTeams = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<TeamRow[]> => {
    await requireSuperadmin(context.userId);

    const { data: biz, error } = await supabaseAdmin
      .from("businesses")
      .select("id, name, owner_id, created_at, archived_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const businesses = biz ?? [];
    if (!businesses.length) return [];

    const bizIds = businesses.map((b) => b.id);
    const ownerIds = Array.from(new Set(businesses.map((b) => b.owner_id)));

    const [{ data: members }, { data: profiles }, { data: subs }, authUsers] = await Promise.all([
      supabaseAdmin
        .from("memberships")
        .select("business_id, user_id, status")
        .in("business_id", bizIds),
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ownerIds),
      supabaseAdmin
        .from("subscriptions")
        .select("user_id, status, product_id, created_at")
        .in("user_id", ownerIds)
        .order("created_at", { ascending: false }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const memberCount = new Map<string, number>();
    const activeMemberCount = new Map<string, number>();
    for (const m of members ?? []) {
      memberCount.set(m.business_id, (memberCount.get(m.business_id) ?? 0) + 1);
      if (m.status === "active") {
        activeMemberCount.set(m.business_id, (activeMemberCount.get(m.business_id) ?? 0) + 1);
      }
    }
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? null]));
    const emailMap = new Map<string, string>();
    for (const u of authUsers.data?.users ?? []) if (u.email) emailMap.set(u.id, u.email);
    const planMap = new Map<string, { plan: TeamRow["owner_plan"]; status: string | null }>();
    for (const s of subs ?? []) {
      if (planMap.has(s.user_id)) continue;
      const plan: TeamRow["owner_plan"] =
        s.product_id === "team_plan" ? "team" : s.product_id === "pro_plan" ? "pro" : "other";
      planMap.set(s.user_id, { plan, status: s.status });
    }

    return businesses.map<TeamRow>((b) => {
      const sub = planMap.get(b.owner_id);
      return {
        id: b.id,
        name: b.name,
        owner_id: b.owner_id,
        owner_email: emailMap.get(b.owner_id) ?? null,
        owner_full_name: nameMap.get(b.owner_id) ?? null,
        member_count: memberCount.get(b.id) ?? 0,
        active_member_count: activeMemberCount.get(b.id) ?? 0,
        created_at: b.created_at,
        archived_at: b.archived_at,
        owner_plan: sub?.plan ?? "free",
        owner_plan_status: sub?.status ?? null,
      };
    });
  });
