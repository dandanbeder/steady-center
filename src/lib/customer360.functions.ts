import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LIMITS, PRICING } from "@/lib/entitlements";

async function requirePlatformAdmin(userId: string) {
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
    console.error("[audit]", action, e);
  }
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Unified Customer 360 bundle. */
export const adminGetCustomer360 = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const uid = data.user_id;
    const month = monthKey();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

    const [
      authU,
      ownedBiz,
      memberships,
      calendars,
      aiThisMonth,
      aiHistory,
      sharesGranted,
      sharesReceived,
      activity,
      adminActions,
      supportSessions,
      notes,
      flagOverrides,
      sub,
    ] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(uid),
      supabaseAdmin.from("businesses").select("id, name, created_at").eq("owner_id", uid),
      supabaseAdmin
        .from("memberships")
        .select("id, business_id, role, status, created_at")
        .eq("user_id", uid),
      supabaseAdmin
        .from("calendars")
        .select("id, name, provider, business_id, created_at")
        .eq("owner_id", uid),
      supabaseAdmin
        .from("ai_usage")
        .select("actions, cents, tokens, month")
        .eq("user_id", uid)
        .eq("month", month)
        .maybeSingle(),
      supabaseAdmin
        .from("ai_usage")
        .select("month, actions, cents")
        .eq("user_id", uid)
        .order("month", { ascending: false })
        .limit(12),
      supabaseAdmin.from("shares").select("id, resource_type, resource_id, role, grantee_user_id, created_at").eq("granted_by", uid).limit(200),
      supabaseAdmin.from("shares").select("id, resource_type, resource_id, role, granted_by, created_at").eq("grantee_user_id", uid).limit(200),
      supabaseAdmin
        .from("analytics_events")
        .select("id, type, account_id, metadata, created_at")
        .eq("user_id", uid)
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("admin_audit_log")
        .select("id, admin_id, action, reason, before, after, created_at")
        .eq("target_user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("admin_access_log")
        .select("id, admin_id, mode, reason, started_at, ended_at")
        .eq("target_user_id", uid)
        .order("started_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("admin_user_notes")
        .select("id, body, pinned, author_id, created_at, updated_at")
        .eq("target_user_id", uid)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("user_feature_flag_overrides")
        .select("id, flag_key, enabled, expires_at, reason, created_by, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!authU.data?.user) throw new Error("User not found");

    // Enrich biz / admin ids → email map
    const bizIds = Array.from(new Set([
      ...(ownedBiz.data ?? []).map((b) => b.id),
      ...(memberships.data ?? []).map((m) => m.business_id),
    ]));
    const [{ data: bizMeta }] = await Promise.all([
      bizIds.length
        ? supabaseAdmin.from("businesses").select("id, name").in("id", bizIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const bizMap = new Map((bizMeta ?? []).map((b) => [b.id, b.name]));

    const adminIds = Array.from(new Set([
      ...(adminActions.data ?? []).map((a) => a.admin_id),
      ...(supportSessions.data ?? []).map((s) => s.admin_id),
      ...(notes.data ?? []).map((n) => n.author_id),
      ...(flagOverrides.data ?? []).map((f) => f.created_by).filter(Boolean) as string[],
    ]));
    let adminEmailMap = new Map<string, string>();
    if (adminIds.length) {
      const { data: ulist } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      adminEmailMap = new Map(
        (ulist?.users ?? []).filter((u) => adminIds.includes(u.id)).map((u) => [u.id, u.email ?? ""]),
      );
    }

    // Plan + AI cap calculation
    const productId = sub.data?.product_id ?? null;
    const tier: "free" | "pro" | "team" =
      productId === "team_plan" ? "team" : productId === "pro_plan" ? "pro" : "free";
    const quantity = sub.data?.quantity ?? 1;
    const paidSeats = tier === "team" ? Math.max(quantity, 2) : 1;
    const aiCap = LIMITS[tier].aiActionsPerSeat * paidSeats;
    const aiUsed = aiThisMonth.data?.actions ?? 0;

    const paddleCheckoutUrl =
      sub.data?.paddle_customer_id &&
      sub.data.paddle_customer_id !== "comp" &&
      sub.data.paddle_customer_id !== "trial"
        ? `https://vendors.paddle.com/customers-v2/${encodeURIComponent(sub.data.paddle_customer_id)}`
        : null;

    return {
      user: {
        id: uid,
        email: authU.data.user.email ?? "",
        created_at: authU.data.user.created_at,
        last_sign_in_at: authU.data.user.last_sign_in_at ?? null,
      },
      usage: {
        month,
        ai_actions_used: aiUsed,
        ai_actions_cap: aiCap,
        ai_cents: aiThisMonth.data?.cents ?? 0,
        ai_history: aiHistory.data ?? [],
        accounts_owned: (ownedBiz.data ?? []).length,
        memberships: (memberships.data ?? []).map((m) => ({
          ...m,
          business_name: bizMap.get(m.business_id) ?? "(unknown)",
        })),
        calendars: (calendars.data ?? []).map((c) => ({
          ...c,
          business_name: c.business_id ? bizMap.get(c.business_id) ?? null : null,
        })),
        connections_count: (calendars.data ?? []).filter((c) => c.provider && c.provider !== "manual").length,
      },
      sharing: {
        granted: (sharesGranted.data ?? []).map((s) => ({ ...s, grantee_email: adminEmailMap.get(s.grantee_user_id) ?? "" })),
        received: (sharesReceived.data ?? []).map((s) => ({ ...s, granter_email: s.granted_by ? adminEmailMap.get(s.granted_by) ?? "" : "" })),
      },
      billing: {
        tier,
        quantity,
        paid_seats: paidSeats,
        plan_price_cents:
          tier === "pro" ? PRICING.pro_monthly.amount : tier === "team" ? PRICING.team_monthly.amount * quantity : 0,
        subscription: sub.data ?? null,
        paddle_url: paddleCheckoutUrl,
      },
      activity: (activity.data ?? []).map((a) => ({
        ...a,
        account_name: a.account_id ? bizMap.get(a.account_id) ?? null : null,
      })),
      support: {
        sessions: (supportSessions.data ?? []).map((s) => ({ ...s, admin_email: adminEmailMap.get(s.admin_id) ?? "" })),
        actions: (adminActions.data ?? []).map((a) => ({ ...a, admin_email: adminEmailMap.get(a.admin_id) ?? "" })),
      },
      notes: (notes.data ?? []).map((n) => ({ ...n, author_email: adminEmailMap.get(n.author_id) ?? "" })),
      feature_flags: (flagOverrides.data ?? []).map((f) => ({
        ...f,
        created_by_email: f.created_by ? adminEmailMap.get(f.created_by) ?? "" : "",
      })),
    };
  });

// ---------- Internal notes ----------

export const adminAddCustomerNote = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      target_user_id: z.string().uuid(),
      body: z.string().min(1).max(4000),
      pinned: z.boolean().default(false),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("admin_user_notes")
      .insert({
        target_user_id: data.target_user_id,
        body: data.body,
        pinned: data.pinned,
        author_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.target_user_id, "note.create", null, { id: row.id, pinned: data.pinned }, null);
    return { ok: true, id: row.id };
  });

export const adminUpdateCustomerNote = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      body: z.string().min(1).max(4000).optional(),
      pinned: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const patch: { body?: string; pinned?: boolean } = {};
    if (data.body !== undefined) patch.body = data.body;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    const { data: before } = await supabaseAdmin
      .from("admin_user_notes")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("admin_user_notes").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, before?.target_user_id ?? null, "note.update", before, patch, null);
    return { ok: true };
  });

export const adminDeleteCustomerNote = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("admin_user_notes")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("admin_user_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, before?.target_user_id ?? null, "note.delete", before, null, null);
    return { ok: true };
  });

// ---------- Per-user feature flag overrides ----------

export const adminSetUserFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      flag_key: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
      enabled: z.boolean(),
      expires_at: z.string().datetime().nullable().optional(),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("user_feature_flag_overrides")
      .select("*")
      .eq("user_id", data.user_id)
      .eq("flag_key", data.flag_key)
      .maybeSingle();
    const payload = {
      user_id: data.user_id,
      flag_key: data.flag_key,
      enabled: data.enabled,
      expires_at: data.expires_at ?? null,
      reason: data.reason,
      created_by: context.userId,
    };
    if (before) {
      const { error } = await supabaseAdmin
        .from("user_feature_flag_overrides")
        .update({
          enabled: payload.enabled,
          expires_at: payload.expires_at,
          reason: payload.reason,
        })
        .eq("id", before.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("user_feature_flag_overrides").insert(payload);
      if (error) throw new Error(error.message);
    }
    await logAudit(context.userId, data.user_id, "flag.user.set", before, payload, data.reason);
    return { ok: true };
  });

export const adminClearUserFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("user_feature_flag_overrides")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("user_feature_flag_overrides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, before?.user_id ?? null, "flag.user.clear", before, null, data.reason);
    return { ok: true };
  });
