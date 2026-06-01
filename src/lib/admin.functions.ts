import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") {
    throw new Error("Not authorized");
  }
}

/** Confirms caller is a superadmin (used to gate /admin route). */
export const checkIsPlatformAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("platform_role")
      .eq("id", context.userId)
      .maybeSingle();
    return { isAdmin: data?.platform_role === "superadmin" };
  });

/** List every user with profile + auth info. */
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);
    const ids = authData.users.map((u) => u.id);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, platform_role, status")
      .in("id", ids);
    const pmap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
    return authData.users.map((u) => {
      const p = pmap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: p?.full_name ?? "",
        platform_role: (p?.platform_role as "user" | "superadmin") ?? "user",
        status: (p?.status as "active" | "suspended") ?? "active",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned_until: (u as unknown as { banned_until?: string | null }).banned_until ?? null,
      };
    });
  });

/** Suspend or reactivate a user. */
export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      status: z.enum(["active", "suspended"]),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId && data.status === "suspended") {
      throw new Error("You cannot suspend your own account.");
    }
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.user_id);
    if (pErr) throw new Error(pErr.message);

    // Also ban/unban in auth so suspended users can't sign in
    const banDuration = data.status === "suspended" ? "876000h" : "none";
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: banDuration } as any
    );
    if (aErr) throw new Error(aErr.message);
    return { ok: true };
  });

/** Change a user's platform role. */
export const adminSetPlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      platform_role: z.enum(["user", "superadmin"]),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId && data.platform_role === "user") {
      // Make sure at least one other superadmin remains
      const { count } = await supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("platform_role", "superadmin");
      if ((count ?? 0) <= 1) {
        throw new Error("Cannot demote the last superadmin.");
      }
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ platform_role: data.platform_role })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Announcements ----------

export const adminListAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpsertAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).default(""),
      level: z.enum(["info", "warning", "critical"]).default("info"),
      active: z.boolean().default(false),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("announcements")
        .update({
          title: data.title,
          body: data.body,
          level: data.level,
          active: data.active,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("announcements")
      .insert({
        title: data.title,
        body: data.body,
        level: data.level,
        active: data.active,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const adminDeleteAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.from("announcements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Feature flags ----------

export const adminListFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("feature_flags")
      .select("*")
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpsertFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      key: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
      enabled: z.boolean(),
      description: z.string().max(500).default(""),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("feature_flags")
        .update({
          key: data.key,
          enabled: data.enabled,
          description: data.description,
          updated_by: context.userId,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabaseAdmin.from("feature_flags").insert({
      key: data.key,
      enabled: data.enabled,
      description: data.description,
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.from("feature_flags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Support sessions ----------

export const adminStartSupportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      target_user_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
      mode: z.enum(["read", "write"]).default("read"),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);

    // End any other active sessions for this admin first
    await supabaseAdmin
      .from("admin_access_log")
      .update({ ended_at: new Date().toISOString() })
      .is("ended_at", null)
      .eq("admin_id", context.userId);

    const { data: row, error } = await supabaseAdmin
      .from("admin_access_log")
      .insert({
        admin_id: context.userId,
        target_user_id: data.target_user_id,
        reason: data.reason,
        mode: data.mode,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminSetSupportSessionMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      session_id: z.string().uuid(),
      mode: z.enum(["read", "write"]),
      reason: z.string().min(3).max(500).optional(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: existing, error: sErr } = await supabaseAdmin
      .from("admin_access_log")
      .select("*")
      .eq("id", data.session_id)
      .eq("admin_id", context.userId)
      .is("ended_at", null)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!existing) throw new Error("Session not found or already ended");
    // End the existing log entry and start a new one with the new mode
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("admin_access_log")
      .update({ ended_at: now })
      .eq("id", data.session_id);
    const { data: row, error } = await supabaseAdmin
      .from("admin_access_log")
      .insert({
        admin_id: context.userId,
        target_user_id: existing.target_user_id,
        reason: data.reason ?? `Mode change to ${data.mode}: ${existing.reason}`,
        mode: data.mode,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminEndSupportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ session_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("admin_access_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.session_id)
      .eq("admin_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGetActiveSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // No platform-admin check: non-admins always get null
    const { data } = await supabaseAdmin
      .from("admin_access_log")
      .select("*")
      .eq("admin_id", context.userId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.target_user_id);
    const { data: tprof } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", data.target_user_id)
      .maybeSingle();
    return {
      ...data,
      target_email: target.user?.email ?? "",
      target_name: tprof?.full_name ?? "",
    };
  });

export const adminListAccessLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("admin_access_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const ids = Array.from(
      new Set((data ?? []).flatMap((r) => [r.admin_id, r.target_user_id]))
    );
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const emap = new Map(users?.users.map((u) => [u.id, u.email ?? ""]) ?? []);
    return (data ?? []).map((r) => ({
      ...r,
      admin_email: emap.get(r.admin_id) ?? "",
      target_email: emap.get(r.target_user_id) ?? "",
      _ids: ids, // dummy keeps types happy
    }));
  });
