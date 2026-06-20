// Daily cron endpoint that fans out the admin "Platform Pulse" digest to
// every super-admin whose preference is enabled. Reuses the same shared
// cron-secret pattern as /api/public/hooks/process-reminders.
//
// - cadence='daily'  → send every run
// - cadence='weekly' → send only on Mondays (UTC)
// - cadence='off'    → skip
//
// Idempotent within a 12h window via platform_pulse_last_sent_at so a
// repeated cron tick will not double-send.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail } from "@/lib/email.server";
import { computePulse, renderPulseEmail, type PulseWindow } from "@/lib/platform-pulse-generator.server";

export const Route = createFileRoute("/api/public/hooks/process-platform-pulse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const isMondayUtc = now.getUTCDay() === 1;

        // Recipients = active super-admins who have opted into a cadence
        const { data: admins, error } = await supabaseAdmin
          .from("profiles")
          .select("id, platform_pulse_cadence, platform_pulse_last_sent_at, status, platform_role")
          .eq("platform_role", "superadmin")
          .eq("status", "active")
          .neq("platform_pulse_cadence", "off");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const sent: string[] = [];
        const skipped: string[] = [];
        const failed: Array<{ user_id: string; error: string }> = [];

        // Pre-compute the two possible digests once (no need to recompute per user).
        let dailyCached: Awaited<ReturnType<typeof renderPulseEmail>> | null = null;
        let weeklyCached: Awaited<ReturnType<typeof renderPulseEmail>> | null = null;

        for (const a of admins ?? []) {
          const cadence = (a.platform_pulse_cadence ?? "off") as PulseWindow | "off";
          if (cadence === "off") continue;
          if (cadence === "weekly" && !isMondayUtc) {
            skipped.push(a.id);
            continue;
          }
          // De-dupe: skip if we already sent today (12h grace).
          const last = a.platform_pulse_last_sent_at ? new Date(a.platform_pulse_last_sent_at) : null;
          if (last && now.getTime() - last.getTime() < 12 * 3600 * 1000) {
            skipped.push(a.id);
            continue;
          }

          try {
            const { data: userResp } = await supabaseAdmin.auth.admin.getUserById(a.id);
            const email = userResp?.user?.email;
            if (!email) {
              failed.push({ user_id: a.id, error: "No email on account" });
              continue;
            }

            let rendered: { subject: string; html: string };
            if (cadence === "daily") {
              dailyCached ??= renderPulseEmail(await computePulse("daily"));
              rendered = dailyCached;
            } else {
              weeklyCached ??= renderPulseEmail(await computePulse("weekly"));
              rendered = weeklyCached;
            }

            await sendEmail({ to: email, subject: rendered.subject, html: rendered.html });
            await supabaseAdmin
              .from("profiles")
              .update({ platform_pulse_last_sent_at: now.toISOString() })
              .eq("id", a.id);
            sent.push(a.id);
          } catch (err) {
            failed.push({ user_id: a.id, error: err instanceof Error ? err.message : String(err) });
          }
        }

        return Response.json({
          ok: true,
          sent: sent.length,
          skipped: skipped.length,
          failed,
          ts: now.toISOString(),
        });
      },
    },
  },
});
