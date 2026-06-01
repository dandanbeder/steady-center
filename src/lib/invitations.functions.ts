import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ASSIGNABLE_ROLES = ["admin", "member", "commenter", "viewer"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
type AnyRole = AssignableRole | "owner";

async function requireAdmin(business_id: string, user_id: string) {
  const [{ data: m }, { data: prof }] = await Promise.all([
    supabaseAdmin
      .from("memberships")
      .select("role")
      .eq("business_id", business_id)
      .eq("user_id", user_id)
      .eq("status", "active")
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("platform_role").eq("id", user_id).maybeSingle(),
  ]);
  const isPlatformAdmin = prof?.platform_role === "superadmin";
  const role = (m?.role as AnyRole | undefined) ?? null;
  const rank: Record<AnyRole, number> = {
    viewer: 1, commenter: 2, member: 3, admin: 4, owner: 5,
  };
  if (!isPlatformAdmin && (!role || rank[role] < 4)) {
    throw new Error("Not authorized");
  }
  return role ?? "owner";
}

async function getPublishedOrigin(): Promise<string> {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://steady-center.lovable.app"
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const conn = process.env.RESEND_API_KEY;
  if (!apiKey || !conn) {
    console.warn("[invitations] missing email credentials; skipping email to", opts.to);
    return;
  }
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
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    console.error("[invitations] resend failed", res.status, await res.text());
  }
}

async function sendInviteEmail(opts: {
  to: string;
  businessName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  const subject = `${opts.inviterName} invited you to ${opts.businessName} on Heartbeat`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 16px">You've been invited to Heartbeat</h1>
      <p>${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.businessName)}</strong> as <strong>${escapeHtml(opts.role)}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${opts.acceptUrl}" style="background:#7A8471;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Sign up &amp; request access</a>
      </p>
      <p style="color:#666;font-size:13px">After you create your account, you'll be able to request access. ${escapeHtml(opts.inviterName)} will review and approve.</p>
      <p style="color:#666;font-size:13px;margin-top:16px">Or open this link directly:<br>${opts.acceptUrl}</p>
      <p style="color:#999;font-size:12px;margin-top:32px">If you weren't expecting this, you can ignore this email.</p>
    </div>`;
  await sendEmail({ to: opts.to, subject, html });
}

async function sendApprovalEmail(opts: { to: string; businessName: string; appUrl: string }) {
  const subject = `You're in: ${opts.businessName} on Heartbeat`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 16px">You've been approved</h1>
      <p>Your request to join <strong>${escapeHtml(opts.businessName)}</strong> has been approved.</p>
      <p style="margin:24px 0">
        <a href="${opts.appUrl}" style="background:#7A8471;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Open Heartbeat</a>
      </p>
    </div>`;
  await sendEmail({ to: opts.to, subject, html });
}

async function getInviterName(user_id: string): Promise<string> {
  const [{ data: prof }, { data: u }] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name").eq("id", user_id).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(user_id),
  ]);
  return prof?.full_name?.trim() || u.user?.email || "A teammate";
}

async function findUserByEmail(email: string) {
  // listUsers paginates; for our scale a single page is fine.
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Invite a user by email. Always returns ok:true (no account enumeration). */
export const inviteByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        business_id: z.string().uuid(),
        email: z.string().email().max(320),
        role: z.enum(ASSIGNABLE_ROLES),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireAdmin(data.business_id, userId);
    const email = data.email.trim().toLowerCase();

    try {
      // Silently skip if already an active member
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        const { data: m } = await supabaseAdmin
          .from("memberships")
          .select("id")
          .eq("business_id", data.business_id)
          .eq("user_id", existingUser.id)
          .eq("status", "active")
          .maybeSingle();
        if (m) return { ok: true };
      }

      // Reuse or create the invitation row
      const { data: existingInv } = await supabaseAdmin
        .from("invitations")
        .select("id, token")
        .eq("business_id", data.business_id)
        .ilike("invited_email", email)
        .eq("status", "sent")
        .maybeSingle();

      let token: string;
      if (existingInv) {
        token = existingInv.token;
        await supabaseAdmin
          .from("invitations")
          .update({
            proposed_role: data.role,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq("id", existingInv.id);
      } else {
        const { data: inserted, error } = await supabaseAdmin
          .from("invitations")
          .insert({
            business_id: data.business_id,
            invited_email: email,
            proposed_role: data.role,
            invited_by: userId,
          })
          .select("token")
          .single();
        if (error) throw error;
        token = inserted.token;
      }

      const [{ data: biz }, inviterName] = await Promise.all([
        supabaseAdmin.from("businesses").select("name").eq("id", data.business_id).maybeSingle(),
        getInviterName(userId),
      ]);
      const origin = await getPublishedOrigin();
      await sendInviteEmail({
        to: email,
        businessName: biz?.name ?? "an account",
        inviterName,
        role: data.role,
        acceptUrl: `${origin}/accept-invite?token=${token}`,
      });
    } catch (e) {
      // Log but always return ok:true to avoid leaking state.
      console.error("[invitations.inviteByEmail]", e);
    }

    return { ok: true };
  });

/** List invitations for an account (admin+). */
export const listInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireAdmin(data.business_id, userId);
    const { data: rows, error } = await supabaseAdmin
      .from("invitations")
      .select("id, invited_email, proposed_role, status, created_at, expires_at")
      .eq("business_id", data.business_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Revoke an invitation. */
export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ invitation_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: inv, error } = await supabaseAdmin
      .from("invitations")
      .select("business_id")
      .eq("id", data.invitation_id)
      .single();
    if (error) throw new Error(error.message);
    await requireAdmin(inv.business_id, userId);
    const { error: uErr } = await supabaseAdmin
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", data.invitation_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

/** Resend an invitation email (refresh token + expiry). */
export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ invitation_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: inv, error } = await supabaseAdmin
      .from("invitations")
      .select("business_id, invited_email, proposed_role, token, status")
      .eq("id", data.invitation_id)
      .single();
    if (error) throw new Error(error.message);
    if (inv.status !== "sent") throw new Error("Invitation is not active.");
    await requireAdmin(inv.business_id, userId);

    const newExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("invitations")
      .update({ expires_at: newExpiry })
      .eq("id", data.invitation_id);

    const [{ data: biz }, inviterName] = await Promise.all([
      supabaseAdmin.from("businesses").select("name").eq("id", inv.business_id).maybeSingle(),
      getInviterName(userId),
    ]);
    const origin = await getPublishedOrigin();
    await sendInviteEmail({
      to: inv.invited_email,
      businessName: biz?.name ?? "an account",
      inviterName,
      role: inv.proposed_role,
      acceptUrl: `${origin}/accept-invite?token=${inv.token}`,
    });
    return { ok: true };
  });

/** Look up the invitation matching a token. Public-ish: only useful if you have the token. */
export const getInvitationByToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ token: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { data: inv } = await supabaseAdmin
      .from("invitations")
      .select("id, business_id, invited_email, proposed_role, status, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!inv) return null;
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("id", inv.business_id)
      .maybeSingle();
    return { ...inv, business_name: biz?.name ?? "an account" };
  });

/** List invitations matching the signed-in user's email (signed-in users). */
export const listMyInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = u.user?.email?.toLowerCase();
    if (!email) return [];

    const { data: invs } = await supabaseAdmin
      .from("invitations")
      .select("id, business_id, proposed_role, status, created_at, expires_at")
      .ilike("invited_email", email)
      .eq("status", "sent");
    if (!invs?.length) return [];

    const bizIds = [...new Set(invs.map((i) => i.business_id))];
    const [{ data: bizes }, { data: reqs }, { data: memberships }] = await Promise.all([
      supabaseAdmin.from("businesses").select("id, name").in("id", bizIds),
      supabaseAdmin
        .from("access_requests")
        .select("business_id, status")
        .eq("requester_user_id", userId)
        .in("business_id", bizIds),
      supabaseAdmin
        .from("memberships")
        .select("business_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .in("business_id", bizIds),
    ]);
    const bizName = new Map((bizes ?? []).map((b) => [b.id, b.name]));
    const requestByBiz = new Map((reqs ?? []).map((r) => [r.business_id, r.status]));
    const memberSet = new Set((memberships ?? []).map((m) => m.business_id));

    return invs
      .filter((i) => !memberSet.has(i.business_id))
      .map((i) => ({
        ...i,
        business_name: bizName.get(i.business_id) ?? "an account",
        request_status: requestByBiz.get(i.business_id) ?? null,
      }));
  });

/** Create an access request for the signed-in user based on an invitation token. */
export const requestAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ token: z.string().uuid(), message: z.string().max(500).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: inv, error } = await supabaseAdmin
      .from("invitations")
      .select("id, business_id, invited_email, proposed_role, status, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invitation not found.");
    if (inv.status !== "sent") throw new Error("This invitation is no longer active.");
    if (new Date(inv.expires_at) < new Date()) {
      await supabaseAdmin.from("invitations").update({ status: "expired" }).eq("id", inv.id);
      throw new Error("This invitation has expired.");
    }

    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const myEmail = u.user?.email?.toLowerCase();
    if (!myEmail || myEmail !== inv.invited_email.toLowerCase()) {
      throw new Error("This invitation was sent to a different email address.");
    }

    // Already an active member?
    const { data: existingMembership } = await supabaseAdmin
      .from("memberships")
      .select("id")
      .eq("business_id", inv.business_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (existingMembership) {
      return { ok: true, status: "already_member" as const };
    }

    // Idempotent: reuse a pending request
    const { data: existingReq } = await supabaseAdmin
      .from("access_requests")
      .select("id, status")
      .eq("business_id", inv.business_id)
      .eq("requester_user_id", userId)
      .in("status", ["pending"])
      .maybeSingle();
    if (existingReq) return { ok: true, status: "pending" as const };

    const { error: insErr } = await supabaseAdmin.from("access_requests").insert({
      business_id: inv.business_id,
      requester_user_id: userId,
      invitation_id: inv.id,
      proposed_role: inv.proposed_role,
      message: data.message ?? null,
    });
    if (insErr) throw new Error(insErr.message);
    return { ok: true, status: "pending" as const };
  });

/** Admin+ — list pending access requests for an account. */
export const listPendingRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireAdmin(data.business_id, userId);
    const { data: rows, error } = await supabaseAdmin
      .from("access_requests")
      .select("id, requester_user_id, message, proposed_role, status, created_at")
      .eq("business_id", data.business_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const userIds = [...new Set(rows.map((r) => r.requester_user_id))];
    const [{ data: profs }, ...userResults] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds),
      ...userIds.map((id) => supabaseAdmin.auth.admin.getUserById(id)),
    ]);
    const profById = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    const emailById = new Map(
      userResults.map((res, idx) => [userIds[idx], res.data.user?.email ?? null]),
    );

    return rows.map((r) => ({
      ...r,
      full_name: profById.get(r.requester_user_id) ?? null,
      email: emailById.get(r.requester_user_id) ?? null,
    }));
  });

/** Admin+ — approve or deny an access request. On approve, creates an active membership. */
export const decideAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        request_id: z.string().uuid(),
        decision: z.enum(["approve", "deny"]),
        role: z.enum(ASSIGNABLE_ROLES).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: req, error } = await supabaseAdmin
      .from("access_requests")
      .select("id, business_id, requester_user_id, invitation_id, proposed_role, status")
      .eq("id", data.request_id)
      .single();
    if (error) throw new Error(error.message);
    if (req.status !== "pending") throw new Error("This request has already been decided.");
    await requireAdmin(req.business_id, userId);

    if (data.decision === "deny") {
      await supabaseAdmin
        .from("access_requests")
        .update({ status: "denied", decided_by: userId, decided_at: new Date().toISOString() })
        .eq("id", req.id);
      return { ok: true, decision: "denied" as const };
    }

    const finalRole: AssignableRole = data.role ?? (req.proposed_role as AssignableRole);

    // Create active membership (idempotent if already exists)
    const { data: existing } = await supabaseAdmin
      .from("memberships")
      .select("id")
      .eq("business_id", req.business_id)
      .eq("user_id", req.requester_user_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("memberships")
        .update({ role: finalRole, status: "active", invited_by: userId })
        .eq("id", existing.id);
    } else {
      const { error: mErr } = await supabaseAdmin.from("memberships").insert({
        business_id: req.business_id,
        user_id: req.requester_user_id,
        role: finalRole,
        status: "active",
        invited_by: userId,
      });
      if (mErr) throw new Error(mErr.message);
    }

    await supabaseAdmin
      .from("access_requests")
      .update({ status: "approved", decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", req.id);

    if (req.invitation_id) {
      await supabaseAdmin
        .from("invitations")
        .update({ status: "accepted" })
        .eq("id", req.invitation_id);
    }

    // Send approval email
    const [{ data: biz }, { data: u }] = await Promise.all([
      supabaseAdmin.from("businesses").select("name").eq("id", req.business_id).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(req.requester_user_id),
    ]);
    const email = u.user?.email;
    if (email) {
      const origin = await getPublishedOrigin();
      await sendApprovalEmail({
        to: email,
        businessName: biz?.name ?? "an account",
        appUrl: `${origin}/today`,
      });
    }

    return { ok: true, decision: "approved" as const, role: finalRole };
  });
