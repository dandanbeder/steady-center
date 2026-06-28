/**
 * Hourly Google Calendar incremental sync, called by pg_cron.
 * Iterates every google-provider calendar in the system and re-syncs.
 *
 * Auth: Supabase anon key via `apikey` header (handler verifies).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runSyncForCalendar } from "@/lib/google-calendar.functions";

export const Route = createFileRoute("/api/public/hooks/sync-calendars")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data: cals, error } = await supabaseAdmin
          .from("calendars")
          .select("id, external_id, sync_token")
          .eq("provider", "google");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; detail?: unknown; error?: string }> = [];
        for (const c of cals ?? []) {
          if (!c.external_id) continue;
          try {
            const r = await runSyncForCalendar(supabaseAdmin, c.id, c.external_id, c.sync_token);
            results.push({ id: c.id, ok: true, detail: r });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("sync-calendars error", c.id, msg);
            await supabaseAdmin
              .from("calendars")
              .update({ last_sync_error: msg.slice(0, 500), last_sync_error_at: new Date().toISOString() })
              .eq("id", c.id);
            results.push({ id: c.id, ok: false, error: msg });
          }
        }
        return Response.json({ synced: results.length, results });

      },
    },
  },
});
