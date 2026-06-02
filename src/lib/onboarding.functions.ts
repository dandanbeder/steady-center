import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, getAppOrigin, sendEmail, escapeHtml } from "./email.server";

/**
 * Send a branded welcome email to the newly signed-up user, and notify
 * platform admins. Called from the signup flow client-side. Unauthenticated
 * because the user may not have a session yet (email confirmation pending).
 * Idempotency: safe to call repeatedly — Resend will just send again, so the
 * client should only invoke once.
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
    const origin = getAppOrigin();
    const name = data.full_name?.trim() || "there";

    // 1) Welcome email to the new user
    const welcomeHtml = brandedEmail({
      heading: `Welcome to Heartbeat, ${name}`,
      intro:
        "We're glad you're here. Heartbeat is a quiet place to track your week — your tasks, calendar, notes, and meetings, all in one calm view.",
      bodyHtml: `
        <p style="margin:0 0 10px;line-height:1.55;color:#3a3a3a">A few good first steps:</p>
        <ul style="margin:0 0 16px 18px;padding:0;color:#3a3a3a;line-height:1.7">
          <li>Open <strong>Today</strong> to see what's on your plate.</li>
          <li>Add your first <strong>account</strong> in Settings — each gets its own color and calendars.</li>
          <li>Connect <strong>Google</strong> or <strong>Microsoft / Outlook</strong> in Connections to sync your calendar.</li>
        </ul>`,
      ctaLabel: "Open Heartbeat",
      ctaUrl: `${origin}/today`,
      footer:
        "If you didn't create this account, you can safely ignore this email.",
    });
    await sendEmail({
      to: data.email,
      subject: "Welcome to Heartbeat 🌿",
      html: welcomeHtml,
    });

    // 2) Notify platform admins
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
          intro: `${name} (${data.email}) just created a Heartbeat account.`,
          bodyHtml: `<p style="margin:0;color:#3a3a3a">Email: <strong>${escapeHtml(
            data.email,
          )}</strong></p>`,
          ctaLabel: "Open admin",
          ctaUrl: `${origin}/admin`,
        });
        await sendEmail({
          to: adminEmails,
          subject: `New sign-up: ${data.email}`,
          html,
          replyTo: data.email,
        });
      }
    }

    return { ok: true };
  });
