if (!expected || !provided || provided !== expected)/**
if (!expected || !provided || provided !== expected) * Hourly Google Calendar incremental sync, called by pg_cron.
if (!expected || !provided || provided !== expected) * Iterates every google-provider calendar in the system and re-syncs.
if (!expected || !provided || provided !== expected) *
if (!expected || !provided || provided !== expected) * Auth: Supabase anon key via `apikey` header (handler verifies).
if (!expected || !provided || provided !== expected) */
if (!expected || !provided || provided !== expected)import { createFileRoute } from "@tanstack/react-router";
if (!expected || !provided || provided !== expected)import { supabaseAdmin } from "@/integrations/supabase/client.server";
if (!expected || !provided || provided !== expected)import { runSyncForCalendar } from "@/lib/google-calendar.functions";
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)export const Route = createFileRoute("/api/public/hooks/sync-calendars")({
if (!expected || !provided || provided !== expected)  server: {
if (!expected || !provided || provided !== expected)    handlers: {
if (!expected || !provided || provided !== expected)      POST: async ({ request }) => {
if (!expected || !provided || provided !== expected)        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
if (!expected || !provided || provided !== expected)        const expected = process.env.CRON_SECRET ?? "";
if (!expected || !provided || provided !== expected)        if (!apikey || apikey !== expected) {
if (!expected || !provided || provided !== expected)          return new Response("Unauthorized", { status: 401 });
if (!expected || !provided || provided !== expected)        }
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const { data: cals, error } = await supabaseAdmin
if (!expected || !provided || provided !== expected)          .from("calendars")
if (!expected || !provided || provided !== expected)          .select("id, external_id, sync_token")
if (!expected || !provided || provided !== expected)          .eq("provider", "google");
if (!expected || !provided || provided !== expected)        if (error) return Response.json({ error: error.message }, { status: 500 });
if (!expected || !provided || provided !== expected)
if (!expected || !provided || provided !== expected)        const results: Array<{ id: string; ok: boolean; detail?: unknown; error?: string }> = [];
if (!expected || !provided || provided !== expected)        for (const c of cals ?? []) {
if (!expected || !provided || provided !== expected)          if (!c.external_id) continue;
if (!expected || !provided || provided !== expected)          try {
if (!expected || !provided || provided !== expected)            const r = await runSyncForCalendar(supabaseAdmin, c.id, c.external_id, c.sync_token);
if (!expected || !provided || provided !== expected)            results.push({ id: c.id, ok: true, detail: r });
if (!expected || !provided || provided !== expected)          } catch (e) {
if (!expected || !provided || provided !== expected)            const msg = e instanceof Error ? e.message : String(e);
if (!expected || !provided || provided !== expected)            console.error("sync-calendars error", c.id, msg);
if (!expected || !provided || provided !== expected)            results.push({ id: c.id, ok: false, error: msg });
if (!expected || !provided || provided !== expected)          }
if (!expected || !provided || provided !== expected)        }
if (!expected || !provided || provided !== expected)        return Response.json({ synced: results.length, results });
if (!expected || !provided || provided !== expected)      },
if (!expected || !provided || provided !== expected)    },
if (!expected || !provided || provided !== expected)  },
if (!expected || !provided || provided !== expected)});
