if (!expected || !provided || provided !== expected)/**
if (!expected || !provided || provided !== expected) * Weekly review cron entry — called hourly by pg_cron.
if (!expected || !provided || provided !== expected) * Schedules in each user's IANA timezone; the cron runs in UTC and we
if (!expected || !provided || provided !== expected) * filter by computing wall-clock weekday/hour in the user's timezone.
if (!expected || !provided || provided !== expected) * Auth: Supabase publishable key via `apikey` header.
if (!expected || !provided || provided !== expected) * Pass ?force=true&user_id=... to bypass scheduling (used by Generate Now).
if (!expected || !provided || provided !== expected) */
if (!expected || !provided || provided !== expected)import { createFileRoute } from "@tanstack/react-router";
if (!expected || !provided || provided !== expected)import { supabaseAdmin } from "@/integrations/supabase/client.server";
if (!expected || !provided || provided !== expected)import { generateForUser } from "@/lib/weekly-report-generator.server";
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)type ProfileRow = {
if (!expected || !provided || provided !== expected)  id: string;
if (!expected || !provided || provided !== expected)  weekly_review_day: number;
if (!expected || !provided || provided !== expected)  weekly_review_hour: number;
if (!expected || !provided || provided !== expected)  weekly_review_enabled: boolean;
if (!expected || !provided || provided !== expected)  timezone: string | null;
if (!expected || !provided || provided !== expected)};
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)function localParts(d: Date, tz: string) {
if (!expected || !provided || provided !== expected)  const fmt = new Intl.DateTimeFormat("en-US", {
if (!expected || !provided || provided !== expected)    timeZone: tz,
if (!expected || !provided || provided !== expected)    weekday: "short",
if (!expected || !provided || provided !== expected)    hour: "2-digit",
if (!expected || !provided || provided !== expected)    hour12: false,
if (!expected || !provided || provided !== expected)  });
if (!expected || !provided || provided !== expected)  const parts = fmt.formatToParts(d);
if (!expected || !provided || provided !== expected)  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
if (!expected || !provided || provided !== expected)  const wd: Record<string, number> = {
if (!expected || !provided || provided !== expected)    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
if (!expected || !provided || provided !== expected)  };
if (!expected || !provided || provided !== expected)  return {
if (!expected || !provided || provided !== expected)    weekday: wd[get("weekday")] ?? 0,
if (!expected || !provided || provided !== expected)    hour: parseInt(get("hour") || "0", 10) % 24,
if (!expected || !provided || provided !== expected)  };
if (!expected || !provided || provided !== expected)}
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)export const Route = createFileRoute("/api/public/hooks/generate-weekly-reports")({
if (!expected || !provided || provided !== expected)  server: {
if (!expected || !provided || provided !== expected)    handlers: {
if (!expected || !provided || provided !== expected)      POST: async ({ request }) => {
if (!expected || !provided || provided !== expected)        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
if (!expected || !provided || provided !== expected)        const expected = process.env.CRON_SECRET ?? "";
if (!expected || !provided || provided !== expected)        if (!apikey || apikey !== expected) {
if (!expected || !provided || provided !== expected)          return new Response("Unauthorized", { status: 401 });
if (!expected || !provided || provided !== expected)        }
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const now = new Date();
if (!expected || !provided || provided !== expected)        const url = new URL(request.url);
if (!expected || !provided || provided !== expected)        const force = url.searchParams.get("force") === "true";
if (!expected || !provided || provided !== expected)        const forceUser = url.searchParams.get("user_id");
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        let q = supabaseAdmin
if (!expected || !provided || provided !== expected)          .from("profiles")
if (!expected || !provided || provided !== expected)          .select(
if (!expected || !provided || provided !== expected)            "id, weekly_review_day, weekly_review_hour, weekly_review_enabled, timezone",
if (!expected || !provided || provided !== expected)          )
if (!expected || !provided || provided !== expected)          .eq("weekly_review_enabled", true);
if (!expected || !provided || provided !== expected)        if (forceUser) q = q.eq("id", forceUser);
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const { data: profiles, error: pErr } = await q;
if (!expected || !provided || provided !== expected)        if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const weekEnd = now;
if (!expected || !provided || provided !== expected)        const weekStart = new Date(now.getTime() - 7 * 86400_000);
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const results: Array<{
if (!expected || !provided || provided !== expected)          user_id: string;
if (!expected || !provided || provided !== expected)          ok: boolean;
if (!expected || !provided || provided !== expected)          report_id?: string;
if (!expected || !provided || provided !== expected)          error?: string;
if (!expected || !provided || provided !== expected)        }> = [];
if (!expected || !provided || provided !== expected)        let matched = 0;
if (!expected || !provided || provided !== expected)        for (const p of (profiles ?? []) as ProfileRow[]) {
if (!expected || !provided || provided !== expected)          if (!force) {
if (!expected || !provided || provided !== expected)            const tz = p.timezone || "Africa/Johannesburg";
if (!expected || !provided || provided !== expected)            let local: { weekday: number; hour: number };
if (!expected || !provided || provided !== expected)            try {
if (!expected || !provided || provided !== expected)              local = localParts(now, tz);
if (!expected || !provided || provided !== expected)            } catch {
if (!expected || !provided || provided !== expected)              local = localParts(now, "UTC");
if (!expected || !provided || provided !== expected)            }
if (!expected || !provided || provided !== expected)            if (
if (!expected || !provided || provided !== expected)              local.weekday !== p.weekly_review_day ||
if (!expected || !provided || provided !== expected)              local.hour !== p.weekly_review_hour
if (!expected || !provided || provided !== expected)            ) {
if (!expected || !provided || provided !== expected)              continue;
if (!expected || !provided || provided !== expected)            }
if (!expected || !provided || provided !== expected)          }
if (!expected || !provided || provided !== expected)          matched++;
if (!expected || !provided || provided !== expected)          try {
if (!expected || !provided || provided !== expected)            const id = await generateForUser(p.id, weekStart, weekEnd);
if (!expected || !provided || provided !== expected)            results.push({ user_id: p.id, ok: true, report_id: id });
if (!expected || !provided || provided !== expected)          } catch (e) {
if (!expected || !provided || provided !== expected)            const msg = e instanceof Error ? e.message : String(e);
if (!expected || !provided || provided !== expected)            console.error("weekly review failed", p.id, msg);
if (!expected || !provided || provided !== expected)            results.push({ user_id: p.id, ok: false, error: msg });
if (!expected || !provided || provided !== expected)          }
if (!expected || !provided || provided !== expected)        }
if (!expected || !provided || provided !== expected)        return Response.json({ matched, results });
if (!expected || !provided || provided !== expected)      },
if (!expected || !provided || provided !== expected)    },
if (!expected || !provided || provided !== expected)  },
if (!expected || !provided || provided !== expected)});
