/**
 * Weekly review cron entry — called hourly by pg_cron.
 * For each user whose schedule matches the current UTC slot, run the
 * generator. Auth: Supabase publishable key via `apikey` header.
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
};

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
          .select("id, weekly_review_day, weekly_review_hour, weekly_review_enabled")
          .eq("weekly_review_enabled", true);
        if (!force) {
          q = q
            .eq("weekly_review_day", now.getUTCDay())
            .eq("weekly_review_hour", now.getUTCHours());
        }
        if (forceUser) q = q.eq("id", forceUser);

        const { data: profiles, error: pErr } = await q;
        if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

        const weekEnd = now;
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const results: Array<{
          user_id: string;
          ok: boolean;
          report_id?: string;
          error?: string;
        }> = [];
        for (const p of (profiles ?? []) as ProfileRow[]) {
          try {
            const id = await generateForUser(p.id, weekStart, weekEnd);
            results.push({ user_id: p.id, ok: true, report_id: id });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("weekly review failed", p.id, msg);
            results.push({ user_id: p.id, ok: false, error: msg });
          }
        }
        return Response.json({ matched: (profiles ?? []).length, results });
      },
    },
  },
});
