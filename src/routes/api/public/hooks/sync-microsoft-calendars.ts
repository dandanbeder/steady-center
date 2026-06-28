/**
 * Hourly Microsoft Graph delta sync. Called by pg_cron.
 * Auth: private CRON_SECRET via x-cron-secret header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runMicrosoftSyncForCalendar } from "@/lib/microsoft-calendar.server-sync";

export const Route = createFileRoute("/api/public/hooks/sync-microsoft-calendars")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const xcron = request.headers.get("x-cron-secret");
        const expectedCron = process.env.CRON_SECRET ?? "";
        if (!expectedCron || xcron !== expectedCron) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data: cals, error } = await supabaseAdmin
          .from("calendars")
          .select("id, external_id, sync_token, owner_id")
          .eq("provider", "microsoft");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; detail?: unknown; error?: string }> = [];
        for (const c of cals ?? []) {
          if (!c.external_id || !c.owner_id) continue;
          try {
            const r = await runMicrosoftSyncForCalendar(
              supabaseAdmin,
              c.owner_id,
              c.id,
              c.external_id,
              c.sync_token,
            );
            results.push({ id: c.id, ok: true, detail: r });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("sync-microsoft-calendars error", c.id, msg);
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
