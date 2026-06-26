/**
 * Daily Pulse cron entry, called every 5 minutes by pg_cron.
 * For each user with morning/evening pulse enabled, checks if their local
 * wall-clock hour:minute matches their chosen time (rounded to 5-min slot)
 * and generates the pulse. Auth: shared CRON_SECRET via apikey/x-cron-secret.
 * Pass ?force=true&user_id=...&kind=morning|evening to bypass scheduling.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generatePulseForUser } from "@/lib/daily-pulse-generator.server";

function localParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    weekday: wdMap[get("weekday")] ?? 0,
  };
}

function matchesSlot(localH: number, localM: number, targetH: number, targetM: number) {
  // Match within the same 5-minute slot (cron runs every 5 min).
  if (localH !== targetH) return false;
  return Math.floor(localM / 5) === Math.floor(targetM / 5);
}

const JOURNAL_REMINDER_LINES = [
  "A quiet moment, take a minute to reflect or write, whenever you're ready.",
  "Your Journal is here when you'd like a pause to put words to the day.",
  "A small, private space to think. Open it when it feels right.",
];

export const Route = createFileRoute("/api/public/hooks/daily-pulse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";
        const forceUser = url.searchParams.get("user_id");
        const forceKind = url.searchParams.get("kind") as "morning" | "evening" | null;
        const now = new Date();

        // Pull notification prefs joined with profile timezone + auth email
        let q = supabaseAdmin
          .from("notification_prefs")
          .select("user_id, events, channels, quiet_enabled, quiet_start, quiet_end");
        if (forceUser) q = q.eq("user_id", forceUser);
        const { data: prefs, error } = await q;
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: Array<{ user_id: string; kind: string; ok: boolean; reason?: string }> = [];
        let matched = 0;

        for (const p of (prefs ?? []) as any[]) {
          const events = (p.events ?? {}) as any;
          const channels = (p.channels ?? {}) as any;

          // Resolve timezone + email
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("timezone")
            .eq("id", p.user_id)
            .maybeSingle();
          const tz = prof?.timezone || "Africa/Johannesburg";

          let local;
          try { local = localParts(now, tz); } catch { local = localParts(now, "UTC"); }

          const kinds: Array<"morning" | "evening"> = [];
          if (force && forceKind) {
            kinds.push(forceKind);
          } else {
            if (events.morning_pulse_enabled !== false) {
              const h = events.morning_pulse_hour ?? 7;
              const m = events.morning_pulse_minute ?? 30;
              if (matchesSlot(local.hour, local.minute, h, m)) kinds.push("morning");
            }
            if (events.evening_winddown_enabled !== false) {
              const h = events.evening_winddown_hour ?? 17;
              const m = events.evening_winddown_minute ?? 30;
              if (matchesSlot(local.hour, local.minute, h, m)) kinds.push("evening");
            }
          }
          if (kinds.length === 0) continue;
          matched++;

          // Lookup email
          let userEmail: string | null = null;
          try {
            const { data: u } = await supabaseAdmin.auth.admin.getUserById(p.user_id);
            userEmail = u.user?.email ?? null;
          } catch {}

          for (const kind of kinds) {
            try {
              const r = await generatePulseForUser(p.user_id, kind, now, {
                allowEmail: channels.email !== false,
                tz,
                userEmail,
                quietEnabled: p.quiet_enabled,
                quietStart: p.quiet_start,
                quietEnd: p.quiet_end,
                emailMorning: events.morning_pulse_email === true,
              });
              results.push({ user_id: p.user_id, kind, ok: r.ok, reason: r.reason });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error("[daily-pulse]", p.user_id, kind, msg);
              results.push({ user_id: p.user_id, kind, ok: false, reason: msg });
            }
          }

          // Optional, opt-in journaling reminder. Calm, no AI, never reads journal content.
          try {
            if (events.journal_reminder_enabled === true) {
              const jh = events.journal_reminder_hour ?? 21;
              const jm = events.journal_reminder_minute ?? 0;
              const cadence = events.journal_reminder_cadence === "weekly" ? "weekly" : "daily";
              const day = Number(events.journal_reminder_day ?? 0);
              const dayOk = cadence === "daily" || local.weekday === day;
              const slotOk = matchesSlot(local.hour, local.minute, jh, jm);
              if (dayOk && slotOk) {
                const body = JOURNAL_REMINDER_LINES[Math.floor(Math.random() * JOURNAL_REMINDER_LINES.length)];
                await supabaseAdmin.from("notifications").insert({
                  user_id: p.user_id,
                  kind: "journal_reminder",
                  title: "A quiet moment for your Journal",
                  body,
                  link: "/journal",
                } as never);

                if (channels.email !== false && events.journal_reminder_email === true && userEmail) {
                  try {
                    const { sendEmail, brandedEmail, getAppOrigin } = await import("@/lib/email.server");
                    const html = brandedEmail({
                      previewText: body,
                      heading: "A quiet moment for your Journal",
                      bodyHtml: `<p style="margin:0 0 12px 0">${body}</p>
                        <p style="margin:0 0 16px 0;color:#666;font-size:13px">No streaks, no missed days. Open it whenever you're ready.</p>
                        <p style="margin:0"><a href="${getAppOrigin()}/journal" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Open Journal</a></p>`,
                    });
                    await sendEmail({
                      to: userEmail,
                      subject: "A quiet moment for your Journal",
                      html,
                    });
                  } catch (e) {
                    console.error("[journal-reminder email]", p.user_id, e);
                  }
                }
                results.push({ user_id: p.user_id, kind: "journal_reminder", ok: true });
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[journal-reminder]", p.user_id, msg);
            results.push({ user_id: p.user_id, kind: "journal_reminder", ok: false, reason: msg });
          }
        }

        return Response.json({ matched, results });
      },
    },
  },
});
