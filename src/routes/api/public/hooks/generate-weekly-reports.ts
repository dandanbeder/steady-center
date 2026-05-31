/**
 * Weekly review cron entry — called hourly by pg_cron.
 * Schedules in each user's IANA timezone; the cron runs in UTC and we
 * filter by computing wall-clock weekday/hour in the user's timezone.
 * Auth: Supabase publishable key via `apikey` header.
 * Pass ?force=true&user_id=... to bypass scheduling (used by Generate Now).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateForUser } from "@/lib/weekly-report-generator.server";

type ProfileRow = {
  id: string;
  weekly_review_day: number;
  weekly_review_hour: number;
  weekly_review_enabled: boolean;
  timezone: string | null;
};

function localParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: wd[get("weekday")] ?? 0,
    hour: parseInt(get("hour") || "0", 10) % 24,
  };
}

export const Route = createFileRoute("/api/public/hooks/generate-weekly-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";
        const forceUser = url.searchParams.get("user_id");

        let q = supabaseAdmin
          .from("profiles")
          .select(
            "id, weekly_review_day, weekly_review_hour, weekly_review_enabled, timezone",
          )
          .eq("weekly_review_enabled", true);
        if (forceUser) q = q.eq("id", forceUser);

        const { data: profiles, error: pErr } = await q;
        if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

        const weekEnd = now;
        const weekStart = new Date(now.getTime() - 7 * 86400_000);

        const results: Array<{
          user_id: string;
          ok: boolean;
          report_id?: string;
          error?: string;
        }> = [];
        let matched = 0;
        for (const p of (profiles ?? []) as ProfileRow[]) {
          if (!force) {
            const tz = p.timezone || "Africa/Johannesburg";
            let local: { weekday: number; hour: number };
            try {
              local = localParts(now, tz);
            } catch {
              local = localParts(now, "UTC");
            }
            if (
              local.weekday !== p.weekly_review_day ||
              local.hour !== p.weekly_review_hour
            ) {
              continue;
            }
          }
          matched++;
          try {
            const id = await generateForUser(p.id, weekStart, weekEnd);
            results.push({ user_id: p.id, ok: true, report_id: id });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("weekly review failed", p.id, msg);
            results.push({ user_id: p.id, ok: false, error: msg });
          }
        }
        return Response.json({ matched, results });
      },
    },
  },
});
