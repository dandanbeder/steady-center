import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
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

/** Append-only audit-log writer. Never fails the parent action — logs server-side. */
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
    console.error("[audit] failed to record entry", action, e);
  }
}

async function countSuperadmins(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("platform_role", "superadmin");
  return count ?? 0;
}

async function assertNotProtectedPrimary(userId: string, action: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_protected_primary")
    .eq("id", userId)
    .maybeSingle();
  if ((data as { is_protected_primary?: boolean } | null)?.is_protected_primary) {
    throw new Error(`The primary super admin cannot be ${action}.`);
  }
}

/** Confirms caller is a superadmin (used to gate /admin route). */
export const checkIsPlatformAdmin = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("platform_role")
      .eq("id", context.userId)
      .maybeSingle();
    return { isAdmin: data?.platform_role === "superadmin" };
  });

/** List every user with profile, plan, and account count. */
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);
    const ids = authData.users.map((u) => u.id);
    const [{ data: profiles }, { data: subs }, { data: bizCounts }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, platform_role, status, marketing_opt_in, deletion_scheduled_at")
        .in("id", ids),
      supabaseAdmin
        .from("subscriptions")
        .select("user_id, status, product_id, current_period_end, environment, created_at")
        .in("user_id", ids)
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("businesses").select("owner_id").in("owner_id", ids),
    ]);
    const pmap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
    const subMap = new Map<string, { plan: string; status: string }>();
    for (const s of subs ?? []) {
      if (subMap.has(s.user_id)) continue;
      const plan = s.product_id === "team_plan" ? "team" : s.product_id === "pro_plan" ? "pro" : "free";
      subMap.set(s.user_id, { plan, status: s.status });
    }
    const bizMap = new Map<string, number>();
    for (const b of bizCounts ?? []) bizMap.set(b.owner_id, (bizMap.get(b.owner_id) ?? 0) + 1);

    return authData.users.map((u) => {
      const p = pmap.get(u.id);
      const s = subMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: p?.full_name ?? "",
        platform_role: (p?.platform_role as "user" | "superadmin") ?? "user",
        status: (p?.status as "active" | "suspended") ?? "active",
        plan: s?.plan ?? "free",
        plan_status: s?.status ?? null,
        accounts_owned: bizMap.get(u.id) ?? 0,
        marketing_opt_in: !!p?.marketing_opt_in,
        deletion_scheduled_at: p?.deletion_scheduled_at ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned_until: (u as unknown as { banned_until?: string | null }).banned_until ?? null,
      };
    });
  });

/** Detail bundle for a single user. */
export const adminGetUser = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const [{ data: authU }, { data: profile }, { data: sub }, { data: overrides }, { data: audit }, { data: biz }] =
      await Promise.all([
        supabaseAdmin.auth.admin.getUserById(data.user_id),
        supabaseAdmin.from("profiles").select("*").eq("id", data.user_id).maybeSingle(),
        supabaseAdmin
          .from("subscriptions")
          .select("*")
          .eq("user_id", data.user_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("user_entitlement_overrides")
          .select("*")
          .eq("user_id", data.user_id)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("admin_audit_log")
          .select("*")
          .eq("target_user_id", data.user_id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabaseAdmin.from("businesses").select("id, name").eq("owner_id", data.user_id),
      ]);
    if (!authU?.user) throw new Error("User not found");
    return {
      auth: {
        id: authU.user.id,
        email: authU.user.email ?? "",
        email_confirmed_at: authU.user.email_confirmed_at ?? null,
        last_sign_in_at: authU.user.last_sign_in_at ?? null,
        created_at: authU.user.created_at,
        banned_until: (authU.user as unknown as { banned_until?: string | null }).banned_until ?? null,
      },
      profile: profile ?? null,
      subscription: sub ?? null,
      overrides: overrides ?? [],
      audit: audit ?? [],
      businesses: biz ?? [],
    };
  });

/** Update profile fields. */
export const adminUpdateProfile = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
      patch: z.object({
        full_name: z.string().max(200).optional(),
        organisation: z.string().max(200).nullable().optional(),
        role_title: z.string().max(120).nullable().optional(),
        phone: z.string().max(32).nullable().optional(),
        timezone: z.string().max(64).optional(),
      }),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("full_name, organisation, role_title, phone, timezone")
      .eq("id", data.user_id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("profiles").update(data.patch).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "profile.update", before, data.patch, data.reason);
    return { ok: true };
  });

/** Change a user's email. Sends notice to old + new addresses. */
export const adminChangeUserEmail = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      new_email: z.string().email().max(320),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const oldEmail = u?.user?.email ?? null;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      email: data.new_email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "auth.email.change", { email: oldEmail }, { email: data.new_email }, data.reason);

    try {
      const { sendEmail, escapeHtml } = await import("@/lib/email.server");
      const html = (addr: string) =>
        `<p>Hi,</p><p>The email address on your Heartbeat account was changed by support.</p>` +
        `<p><strong>Previous:</strong> ${escapeHtml(oldEmail ?? "—")}<br/><strong>New:</strong> ${escapeHtml(data.new_email)}</p>` +
        `<p>If you didn't request this change, contact support immediately.</p>` +
        `<p><em>Sent to ${escapeHtml(addr)} for your security.</em></p>`;
      if (oldEmail && oldEmail !== data.new_email) {
        await sendEmail({ to: oldEmail, subject: "Your Heartbeat email was changed", html: html(oldEmail) });
      }
      await sendEmail({ to: data.new_email, subject: "Your Heartbeat email was changed", html: html(data.new_email) });
    } catch (e) {
      console.error("[admin] email-change notice failed", e);
    }
    return { ok: true };
  });

/** Send a verification (signup confirmation) email. */
export const adminResendVerification = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = u?.user?.email;
    if (!email) throw new Error("User has no email");
    // Use magiclink as a verification re-send — works for confirmed and unconfirmed users.
    const { error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "auth.verification.resend", null, { email }, null);
    return { ok: true };
  });

/** Mark a user's email as verified without sending anything. */
export const adminManuallyVerifyEmail = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { email_confirm: true });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "auth.email.manual_verify", null, { email_confirm: true }, data.reason);
    return { ok: true };
  });

/** Generate and send a password reset link. */
export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = u?.user?.email;
    if (!email) throw new Error("User has no email");
    const { error } = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "auth.password_reset.send", null, { email }, null);
    return { ok: true };
  });

/** Force sign-out from every device. */
export const adminRevokeSessions = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.signOut(data.user_id, "global");
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "auth.sessions.revoke", null, null, data.reason);
    return { ok: true };
  });

/** Set a one-time temporary password, force change at next login, sign all sessions out, and email the user. */
export const adminSetTempPassword = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = u?.user?.email;
    if (!email) throw new Error("User has no email");
    // Generate a strong-ish but readable temp password.
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const tempPassword =
      "Tmp-" + Buffer.from(bytes).toString("base64").replace(/[+/=]/g, "").slice(0, 14) + "9!";
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: tempPassword });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("profiles").update({ must_change_password: true }).eq("id", data.user_id);
    // Sign out everywhere so the user must use the new temp password next.
    await supabaseAdmin.auth.admin.signOut(data.user_id, "global");
    try {
      const { sendEmail, escapeHtml } = await import("@/lib/email.server");
      await sendEmail({
        to: email,
        subject: "Your Heartbeat password was reset by support",
        html:
          `<p>Hi,</p><p>Heartbeat support set a temporary password on your account at your request.</p>` +
          `<p><strong>Temporary password:</strong> <code>${escapeHtml(tempPassword)}</code></p>` +
          `<p>Sign in with it now — you'll be required to choose a new password immediately.</p>` +
          `<p>If you didn't request this, contact support right away.</p>`,
      });
    } catch (e) {
      console.error("[admin] temp-password email failed", e);
    }
    await logAudit(context.userId, data.user_id, "auth.password.temp_set", null, { must_change: true }, data.reason);
    return { ok: true };
  });

/** Adjust the per-user team seat allotment (stored as an entitlement override). */
export const adminAdjustSeats = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      seats: z.number().int().min(0).max(10000),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: existing } = await supabaseAdmin
      .from("user_entitlement_overrides")
      .select("*")
      .eq("user_id", data.user_id)
      .eq("key", "team_seats")
      .maybeSingle();
    if (existing) {
      const { error } = await supabaseAdmin
        .from("user_entitlement_overrides")
        .update({ value: data.seats, note: data.reason })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("user_entitlement_overrides").insert({
        user_id: data.user_id,
        key: "team_seats",
        value: data.seats,
        note: data.reason,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    await logAudit(context.userId, data.user_id, "billing.seats.adjust", existing, { seats: data.seats }, data.reason);
    return { ok: true };
  });

/** Legacy quick-toggle: keep for back-compat. Prefers richer Suspend/Reactivate below. */
export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), status: z.enum(["active", "suspended"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId && data.status === "suspended") {
      throw new Error("You cannot suspend your own account.");
    }
    const { data: before } = await supabaseAdmin.from("profiles").select("status").eq("id", data.user_id).maybeSingle();
    const { error: pErr } = await supabaseAdmin.from("profiles").update({ status: data.status }).eq("id", data.user_id);
    if (pErr) throw new Error(pErr.message);
    const banDuration = data.status === "suspended" ? "876000h" : "none";
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: banDuration } as any,
    );
    if (aErr) throw new Error(aErr.message);
    await logAudit(context.userId, data.user_id, `user.${data.status}`, before, { status: data.status }, null);
    return { ok: true };
  });

/** Suspend with reason + optional user-visible message. */
export const adminSuspendUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
      message: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("You cannot suspend your own account.");
    const { data: tgt } = await supabaseAdmin
      .from("profiles")
      .select("platform_role, status")
      .eq("id", data.user_id)
      .maybeSingle();
    await assertNotProtectedPrimary(data.user_id, "suspended");
    if (tgt?.platform_role === "superadmin" && (await countSuperadmins()) <= 1) {
      throw new Error("Cannot suspend the last superadmin.");
    }
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({
        status: "suspended",
        suspended_reason: data.reason,
        suspended_message: data.message ?? null,
      })
      .eq("id", data.user_id);
    if (pErr) throw new Error(pErr.message);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: "876000h" } as any,
    );
    if (aErr) throw new Error(aErr.message);
    await logAudit(context.userId, data.user_id, "user.suspend", tgt, { status: "suspended", message: data.message ?? null }, data.reason);
    return { ok: true };
  });

export const adminReactivateUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("status, suspended_reason, suspended_message")
      .eq("id", data.user_id)
      .maybeSingle();
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ status: "active", suspended_reason: null, suspended_message: null })
      .eq("id", data.user_id);
    if (pErr) throw new Error(pErr.message);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: "none" } as any,
    );
    if (aErr) throw new Error(aErr.message);
    await logAudit(context.userId, data.user_id, "user.reactivate", before, { status: "active" }, data.reason);
    return { ok: true };
  });

/** Change a user's platform role, with last-superadmin guard. */
export const adminSetPlatformRole = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      platform_role: z.enum(["user", "superadmin"]),
      reason: z.string().min(3).max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId && data.platform_role === "user") {
      throw new Error("You cannot demote your own account.");
    }
    if (data.platform_role === "user") {
      await assertNotProtectedPrimary(data.user_id, "demoted");
      const { data: target } = await supabaseAdmin
        .from("profiles")
        .select("platform_role")
        .eq("id", data.user_id)
        .maybeSingle();
      if (target?.platform_role === "superadmin" && (await countSuperadmins()) <= 1) {
        throw new Error("Cannot demote the last superadmin.");
      }
    }
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("platform_role")
      .eq("id", data.user_id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ platform_role: data.platform_role })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "user.role.change", before, { platform_role: data.platform_role }, data.reason ?? null);
    return { ok: true };
  });

// ---------- Entitlement overrides ----------

export const adminUpsertEntitlementOverride = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      user_id: z.string().uuid(),
      key: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
      value: z.number().int().min(-1000000).max(1000000),
      expires_at: z.string().datetime().nullable().optional(),
      note: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.id) {
      const { data: before } = await supabaseAdmin
        .from("user_entitlement_overrides")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      const { error } = await supabaseAdmin
        .from("user_entitlement_overrides")
        .update({ key: data.key, value: data.value, expires_at: data.expires_at ?? null, note: data.note ?? null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await logAudit(context.userId, data.user_id, "entitlement.update", before, data, null);
      return { ok: true };
    }
    const { error } = await supabaseAdmin.from("user_entitlement_overrides").insert({
      user_id: data.user_id,
      key: data.key,
      value: data.value,
      expires_at: data.expires_at ?? null,
      note: data.note ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "entitlement.create", null, data, null);
    return { ok: true };
  });

export const adminDeleteEntitlementOverride = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("user_entitlement_overrides")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("user_entitlement_overrides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, before?.user_id ?? null, "entitlement.delete", before, null, null);
    return { ok: true };
  });

// ---------- Plan / billing ----------

export const adminCompSubscription = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      plan: z.enum(["pro_plan", "team_plan"]),
      months: z.number().int().min(1).max(120),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + data.months);
    const compId = `comp_${data.user_id.slice(0, 8)}_${Date.now()}`;
    const env = "live" as const;
    const { error } = await supabaseAdmin.from("subscriptions").insert({
      user_id: data.user_id,
      paddle_subscription_id: compId,
      paddle_customer_id: "comp",
      product_id: data.plan,
      price_id: `${data.plan}_comp`,
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
      environment: env,
    });
    if (error) throw new Error(error.message);
    await logAudit(context.userId, data.user_id, "billing.comp", null, { plan: data.plan, months: data.months }, data.reason);
    return { ok: true };
  });

export const adminExtendTrial = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      days: z.number().int().min(1).max(365),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", data.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = sub?.current_period_end ? new Date(sub.current_period_end as string) : new Date();
    const newEnd = new Date(base);
    newEnd.setDate(newEnd.getDate() + data.days);
    if (sub) {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ current_period_end: newEnd.toISOString(), status: "trialing" })
        .eq("id", sub.id);
      if (error) throw new Error(error.message);
    } else {
      const compId = `trial_${data.user_id.slice(0, 8)}_${Date.now()}`;
      await supabaseAdmin.from("subscriptions").insert({
        user_id: data.user_id,
        paddle_subscription_id: compId,
        paddle_customer_id: "trial",
        product_id: "pro_plan",
        price_id: "pro_plan_trial",
        status: "trialing",
        current_period_start: new Date().toISOString(),
        current_period_end: newEnd.toISOString(),
        environment: "live",
      });
    }
    await logAudit(context.userId, data.user_id, "billing.trial.extend", sub, { current_period_end: newEnd }, data.reason);
    return { ok: true };
  });

// ---------- Soft delete (7-day window) ----------

export const adminScheduleUserDeletion = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      typed_email: z.string().email(),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("You cannot delete your own account.");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = u?.user?.email ?? "";
    if (email.toLowerCase() !== data.typed_email.toLowerCase()) {
      throw new Error("Typed email does not match the user's email.");
    }
    const { data: tgt } = await supabaseAdmin
      .from("profiles")
      .select("platform_role")
      .eq("id", data.user_id)
      .maybeSingle();
    if (tgt?.platform_role === "superadmin" && (await countSuperadmins()) <= 1) {
      throw new Error("Cannot delete the last superadmin.");
    }
    const purgeAt = new Date();
    purgeAt.setDate(purgeAt.getDate() + 7);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        deletion_scheduled_at: purgeAt.toISOString(),
        deletion_requested_by: context.userId,
        status: "suspended",
      })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    // Block sign-in during the window
    await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: "876000h" } as any,
    );
    await logAudit(context.userId, data.user_id, "user.delete.schedule", null, { purge_at: purgeAt.toISOString() }, data.reason);
    return { ok: true, purge_at: purgeAt.toISOString() };
  });

export const adminCancelUserDeletion = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ user_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ deletion_scheduled_at: null, deletion_requested_by: null, status: "active" })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ban_duration: "none" } as any,
    );
    await logAudit(context.userId, data.user_id, "user.delete.cancel", null, null, data.reason);
    return { ok: true };
  });

// ---------- Audit log readers ----------

export const adminListAuditLog = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({ target_user_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(500).default(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    let q = supabaseAdmin.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.target_user_id) q = q.eq("target_user_id", data.target_user_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).flatMap((r) => [r.admin_id, r.target_user_id].filter(Boolean) as string[])));
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emap = new Map(users?.users.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]) ?? []);
    return (rows ?? []).map((r) => ({
      ...r,
      admin_email: emap.get(r.admin_id) ?? "",
      target_email: r.target_user_id ? emap.get(r.target_user_id) ?? "" : "",
    }));
  });

// ---------- Announcements ----------

const audienceSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("segment"),
    segment: z.enum(["free", "pro", "team", "paid", "trial"]),
  }),
  z.object({
    kind: z.literal("users"),
    user_ids: z.array(z.string().uuid()).min(1).max(500),
  }),
]);

export const adminListAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
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
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).default(""),
      kind: z.enum(["info", "update", "maintenance", "feature"]).default("info"),
      level: z.enum(["info", "warning", "critical"]).default("info"),
      audience: audienceSchema.default({ kind: "all" }),
      active: z.boolean().default(true),
      publish: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const baseFields = {
      title: data.title,
      body: data.body,
      kind: data.kind,
      level: data.level,
      audience: data.audience as unknown as never,
      active: data.active,
    };
    if (data.id) {
      const { data: before } = await supabaseAdmin
        .from("announcements").select("*").eq("id", data.id).maybeSingle();
      const patch: Record<string, unknown> = { ...baseFields };
      if (data.publish && data.active) {
        const pubAt = before?.published_at ?? now.toISOString();
        patch.published_at = pubAt;
        patch.expires_at = new Date(new Date(pubAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
      const { error } = await supabaseAdmin
        .from("announcements").update(patch as never).eq("id", data.id);
      if (error) throw new Error(error.message);
      await logAudit(context.userId, null, "announcement.update", before, { id: data.id, ...patch }, null);
      return { ok: true, id: data.id };
    }
    const insert = {
      ...baseFields,
      created_by: context.userId,
      source: "manual" as const,
      published_at: data.publish && data.active ? now.toISOString() : null,
      expires_at: data.publish && data.active ? expires.toISOString() : null,
    };
    const { data: row, error } = await supabaseAdmin
      .from("announcements").insert(insert).select("id").single();
    if (error) throw new Error(error.message);
    await logAudit(context.userId, null, "announcement.create", null, { id: row.id, ...insert }, null);
    return { ok: true, id: row.id };
  });

export const adminDeleteAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("announcements").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("announcements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, null, "announcement.delete", before, null, null);
    return { ok: true };
  });

// ---------- Feature flags ----------

export const adminListFlags = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin.from("feature_flags").select("*").order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpsertFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      key: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
      enabled: z.boolean(),
      description: z.string().max(500).default(""),
      announce: z.boolean().default(false),
      feature_label: z.string().max(120).optional(),
      audience: audienceSchema.default({ kind: "all" }),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const wasEnabled = data.id
      ? (await supabaseAdmin.from("feature_flags").select("enabled").eq("id", data.id).maybeSingle()).data?.enabled ?? false
      : false;
    let flagId = data.id;
    if (flagId) {
      const { error } = await supabaseAdmin
        .from("feature_flags")
        .update({ key: data.key, enabled: data.enabled, description: data.description, updated_by: context.userId })
        .eq("id", flagId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabaseAdmin.from("feature_flags").insert({
        key: data.key, enabled: data.enabled, description: data.description, updated_by: context.userId,
      }).select("id").single();
      if (error) throw new Error(error.message);
      flagId = row.id;
    }

    // Flag just turned ON and admin opted to announce → 24h "feature" card
    if (data.announce && data.enabled && !wasEnabled) {
      const label = data.feature_label?.trim() || data.key;
      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await supabaseAdmin.from("announcements").insert({
        title: `New: ${label} is now available`,
        body: data.description || "",
        kind: "feature",
        level: "info",
        audience: data.audience as unknown as never,
        active: true,
        published_at: now.toISOString(),
        expires_at: expires.toISOString(),
        source: "flag",
        source_flag_id: flagId!,
        created_by: context.userId,
      });
      await logAudit(context.userId, null, "announcement.create", null,
        { source: "flag", flag_key: data.key, audience: data.audience }, null);
    }

    await logAudit(context.userId, null, data.id ? "flag.update" : "flag.create",
      { enabled: wasEnabled }, { id: flagId, key: data.key, enabled: data.enabled }, null);
    return { ok: true };
  });

export const adminDeleteFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("feature_flags").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("feature_flags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, null, "flag.delete", before, null, null);
    return { ok: true };
  });

// ---------- Support sessions ----------

export const adminStartSupportSession = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      target_user_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
      mode: z.enum(["read", "write"]).default("read"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
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
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      session_id: z.string().uuid(),
      mode: z.enum(["read", "write"]),
      reason: z.string().min(3).max(500).optional(),
    }).parse(i),
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
    const now = new Date().toISOString();
    await supabaseAdmin.from("admin_access_log").update({ ended_at: now }).eq("id", data.session_id);
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
  .middleware([requireActiveUser])
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
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
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
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("admin_access_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((data ?? []).flatMap((r) => [r.admin_id, r.target_user_id])));
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emap = new Map(users?.users.map((u) => [u.id, u.email ?? ""]) ?? []);
    return (data ?? []).map((r) => ({
      ...r,
      admin_email: emap.get(r.admin_id) ?? "",
      target_email: emap.get(r.target_user_id) ?? "",
      _ids: ids,
    }));
  });
