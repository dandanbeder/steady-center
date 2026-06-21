/**
 * Plan lifecycle sweeper.
 *
 * Runs the timed state transitions Paddle webhooks can't fire on their own:
 *   - trial expired with no conversion -> Free + lock over-limit data
 *   - past_due longer than 3-day grace -> Free + lock over-limit data
 *   - cancellation period actually ended -> lock over-limit data
 *   - Team subscription dropped below 2 seats -> Pro
 *
 * Never deletes user data; only flips status + read_only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/plan-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data, error } = await supabaseAdmin.rpc("sweep_plan_lifecycle");
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true, result: (data ?? [])[0] ?? null });
      },
    },
  },
});
