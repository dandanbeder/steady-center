import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, getAppOrigin, sendEmail, escapeHtml } from "./email.server";

/**
 * Send a branded welcome email to the newly signed-up user, and notify
 * platform admins. Called from the signup flow client-side.
 *
 * Hardening (#10 / #16):
 * - Unauthenticated by necessity (signup may still be pending email
 *   confirmation), but NOT an open relay: we only send when the supplied
 *   email belongs to a real auth user that was created in the last 15
 *   minutes AND has not already received a welcome email.
 * - Once sent we stamp `profiles.welcome_email_sent_at`, so a second call
 *   with the same payload is a no-op (built-in rate limit).
 * - All user-supplied values reaching the email HTML are escaped.
 */
export const sendWelcomeAndNotifyAdmins = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        email: z.string().email().max(320),
        full_name: z.string().max(200).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();

    // 1) Verify a real, fresh signup exists for this email.
    let targetUser:
      | { id: string; email: string; created_at: string }
      | null = null;
    // Page through auth.users to find by email (no admin-by-email endpoint).
    // Newest signups appear on the first page, so this is cheap.
    try {
      const { data: page } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const found = page?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === normalizedEmail,
      );
      if (found?.email && found.created_at) {
        targetUser = {
          id: found.id,
          email: found.email,
          created_at: found.created_at,
        };
      }
    } catch {
      // fall through to silent no-op
    }

    if (!targetUser) {
      // No matching auth user, refuse to send. Return ok to avoid leaking
      // whether an account exists.
      return { ok: true };
    }

    const ageMs = Date.now() - new Date(targetUser.created_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      // Not a fresh signup; refuse to send.
      return { ok: true };
    }

    // Idempotency / per-account rate limit.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, welcome_email_sent_at, full_name")
      .eq("id", targetUser.id)
      .maybeSingle();
    if (profile?.welcome_email_sent_at) {
      return { ok: true };
    }

    // Prefer the server-known name over the client-supplied one for safety.
    const rawName =
      (profile?.full_name ?? data.full_name ?? "").toString().trim() ||
      "there";
    const safeName = escapeHtml(rawName);
    const safeEmail = escapeHtml(targetUser.email);
    const origin = getAppOrigin();

    // 2) Welcome email to the new user
    const welcomeHtml = brandedEmail({
      heading: `Welcome to Heartbeat, ${rawName}`,
      intro:
        "We're glad you're here. Heartbeat is a quiet place to track your week, your tasks, calendar, notes, and meetings, all in one calm view.",
      bodyHtml: `
        <p style="margin:0 0 10px;line-height:1.55;color:#3a3a3a">A few good first steps:</p>
        <ul style="margin:0 0 16px 18px;padding:0;color:#3a3a3a;line-height:1.7">
          <li>Open <strong>Today</strong> to see what's on your plate.</li>
          <li>Add your first <strong>account</strong> in Settings, each gets its own color and calendars.</li>
          <li>Connect <strong>Google</strong> or <strong>Microsoft / Outlook</strong> in Connections to sync your calendar.</li>
        </ul>
        <p style="margin:0 0 16px;line-height:1.55;color:#3a3a3a">Each morning you'll get a calm <strong>Morning Pulse</strong>, and a gentle review each Friday.</p>`,
      ctaLabel: "Open Heartbeat",
      ctaUrl: `${origin}/today`,
      ctaNoteHtml: `Questions? Just reply to this email, or reach us at <a href="mailto:hello@flightmed.software" style="color:#7A8471;text-decoration:none">hello@flightmed.software</a>.`,
    });
    await sendEmail({
      to: targetUser.email,
      subject: "Welcome to Heartbeat 🌿",
      html: welcomeHtml,
      replyTo: "hello@flightmed.software",
    });

    // 3) Notify platform admins (using the verified email, not client input).
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("platform_role", "superadmin");

    if (admins?.length) {
      const adminEmails: string[] = [];
      for (const a of admins) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(a.id);
        if (u.user?.email) adminEmails.push(u.user.email);
      }
      if (adminEmails.length) {
        const html = brandedEmail({
          heading: "New Heartbeat sign-up",
          intro: `${rawName} (${targetUser.email}) just created a Heartbeat account.`,
          bodyHtml: `<p style="margin:0;color:#3a3a3a">Name: <strong>${safeName}</strong><br/>Email: <strong>${safeEmail}</strong></p>`,
          ctaLabel: "Open admin",
          ctaUrl: `${origin}/admin`,
        });
        await sendEmail({
          to: adminEmails,
          subject: `New sign-up: ${targetUser.email}`,
          html,
          replyTo: targetUser.email,
        });
      }
    }

    // 4) Stamp idempotency marker (trusted server context: bypasses the
    // self-update guard via service-role).
    await supabaseAdmin
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", targetUser.id);

    return { ok: true };
  });
