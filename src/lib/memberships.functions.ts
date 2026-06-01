import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLES = ["admin", "member", "commenter", "viewer"] as const;
const ALL_ROLES = ["owner", ...ROLES] as const;

type Role = (typeof ALL_ROLES)[number];

async function requireRole(
  business_id: string,
  user_id: string,
  min: "admin" | "owner"
): Promise<Role> {
  const { data: mine, error } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("business_id", business_id)
    .eq("user_id", user_id)
    .eq("status", "active")
    .maybeSingle();

  // Allow platform admins
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", user_id)
    .maybeSingle();
  const isPlatformAdmin = prof?.platform_role === "superadmin";

  if (error) throw new Error(error.message);
  const role = (mine?.role as Role | undefined) ?? null;
  const rank: Record<Role, number> = {
    viewer: 1, commenter: 2, member: 3, admin: 4, owner: 5,
  };
  const need = min === "owner" ? 5 : 4;
  if (!isPlatformAdmin && (!role || rank[role] < need)) {
    throw new Error("Not authorized");
  }
  return role ?? "owner"; // platform admin treated as owner-equivalent
}

/** List members of a business (admin+ only). */
export const listMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("list_business_members", {
      p_business: data.business_id,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Get the caller's role in a business (or null). */
export const myRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: role, error } = await supabase.rpc("current_membership_role", {
      p_business: data.business_id,
    });
    if (error) throw new Error(error.message);
    // Also check platform admin
    const { data: prof } = await supabase.from("profiles").select("platform_role").maybeSingle();
    const isPlatformAdmin = prof?.platform_role === "superadmin";
    return { role: (role as Role | null) ?? null, isPlatformAdmin: !!isPlatformAdmin };
  });

async function getPublishedOrigin(): Promise<string> {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://steady-center.lovable.app"
  );
}

async function sendInviteEmail(opts: {
  to: string;
  businessName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const conn = process.env.RESEND_API_KEY;
  if (!apiKey || !conn) {
    console.warn("[invite] missing LOVABLE_API_KEY or RESEND_API_KEY; skipping email");
    return;
  }
  const subject = `${opts.inviterName} invited you to ${opts.businessName} on Heartbeat`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 16px">You've been invited to Heartbeat</h1>
      <p>${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.businessName)}</strong> as <strong>${escapeHtml(opts.role)}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${opts.acceptUrl}" style="background:#7A8471;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Accept invite</a>
      </p>
      <p style="color:#666;font-size:13px">Or open this link: <br>${opts.acceptUrl}</p>
      <p style="color:#999;font-size:12px;margin-top:32px">If you weren't expecting this, you can ignore this email.</p>
    </div>`;

  const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Connection-Api-Key": conn,
    },
    body: JSON.stringify({
      from: "Heartbeat <onboarding@resend.dev>",
      to: [opts.to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[invite] resend failed", res.status, text);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/** Invite a user by email to a business. admin+ only. */
export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        business_id: z.string().uuid(),
        email: z.string().email().max(320),
        role: z.enum(ROLES),
      })
      .parse(i)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.business_id, userId, "admin");

    const email = data.email.trim().toLowerCase();

    // Check if user already exists with this email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = users?.users.find((u) => u.email?.toLowerCase() === email);

    // Already a member?
    if (existing) {
      const { data: dupe } = await supabaseAdmin
        .from("memberships")
        .select("id, status")
        .eq("business_id", data.business_id)
        .eq("user_id", existing.id)
        .maybeSingle();
      if (dupe) throw new Error("This person is already a member.");
    } else {
      const { data: dupeInvite } = await supabaseAdmin
        .from("memberships")
        .select("id")
        .eq("business_id", data.business_id)
        .eq("invited_email", email)
        .maybeSingle();
      if (dupeInvite) throw new Error("This email already has a pending invite.");
    }

    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("id", data.business_id)
      .maybeSingle();
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const { data: inviterUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const inviterName =
      inviterProfile?.full_name?.trim() || inviterUser.user?.email || "A teammate";

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const payload = existing
      ? {
          business_id: data.business_id,
          user_id: existing.id,
          invited_email: email,
          role: data.role,
          status: "active" as const,
          invited_by: userId,
          invite_token: null,
          invite_token_expires_at: null,
        }
      : {
          business_id: data.business_id,
          user_id: null,
          invited_email: email,
          role: data.role,
          status: "invited" as const,
          invited_by: userId,
          invite_token: token,
          invite_token_expires_at: expiresAt,
        };

    const { data: inserted, error } = await supabaseAdmin
      .from("memberships")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (!existing) {
      const origin = await getPublishedOrigin();
      const acceptUrl = `${origin}/accept-invite?token=${token}`;
      await sendInviteEmail({
        to: email,
        businessName: biz?.name ?? "a business",
        inviterName,
        role: data.role,
        acceptUrl,
      });
    }

    return { ok: true, membership_id: inserted.id, sent_email: !existing };
  });

/** Update a member's role. admin+ for non-owner; owner-only to grant/transfer owner. */
export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        membership_id: z.string().uuid(),
        role: z.enum(ALL_ROLES),
      })
      .parse(i)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: m, error: e1 } = await supabaseAdmin
      .from("memberships")
      .select("business_id, role")
      .eq("id", data.membership_id)
      .single();
    if (e1) throw new Error(e1.message);

    const min = data.role === "owner" || m.role === "owner" ? "owner" : "admin";
    await requireRole(m.business_id, userId, min as "admin" | "owner");

    const { error } = await supabaseAdmin
      .from("memberships")
      .update({ role: data.role })
      .eq("id", data.membership_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove a member (or revoke an invite). admin+; can't remove the last owner. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ membership_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: m, error: e1 } = await supabaseAdmin
      .from("memberships")
      .select("business_id, role")
      .eq("id", data.membership_id)
      .single();
    if (e1) throw new Error(e1.message);

    const min = m.role === "owner" ? "owner" : "admin";
    await requireRole(m.business_id, userId, min as "admin" | "owner");

    if (m.role === "owner") {
      const { count } = await supabaseAdmin
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("business_id", m.business_id)
        .eq("role", "owner")
        .eq("status", "active");
      if ((count ?? 0) <= 1) throw new Error("Cannot remove the last owner.");
    }

    const { error } = await supabaseAdmin
      .from("memberships")
      .delete()
      .eq("id", data.membership_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Resend an invite email. */
export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ membership_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: m, error } = await supabaseAdmin
      .from("memberships")
      .select("business_id, role, status, invited_email, invite_token")
      .eq("id", data.membership_id)
      .single();
    if (error) throw new Error(error.message);
    if (m.status !== "invited" || !m.invited_email) {
      throw new Error("This membership is not a pending invite.");
    }
    await requireRole(m.business_id, userId, "admin");

    let token = m.invite_token as string | null;
    if (!token) {
      token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const { error: uErr } = await supabaseAdmin
        .from("memberships")
        .update({ invite_token: token, invite_token_expires_at: expiresAt })
        .eq("id", data.membership_id);
      if (uErr) throw new Error(uErr.message);
    }

    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("id", m.business_id)
      .maybeSingle();
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const { data: inviterUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const inviterName =
      inviterProfile?.full_name?.trim() || inviterUser.user?.email || "A teammate";

    const origin = await getPublishedOrigin();
    await sendInviteEmail({
      to: m.invited_email,
      businessName: biz?.name ?? "a business",
      inviterName,
      role: m.role,
      acceptUrl: `${origin}/accept-invite?token=${token}`,
    });
    return { ok: true };
  });

/** Accept an invite by token (signed-in user). */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ token: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: m, error } = await supabase.rpc("accept_invite_by_token", {
      p_token: data.token,
    });
    if (error) throw new Error(error.message);
    return m;
  });
