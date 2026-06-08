/**
 * Twice-daily Microsoft Graph subscription renewal. Renews any subscription
 * expiring within the next 24h. If renewal fails (404), recreates it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renewSubscription, ensureSubscription } from "@/lib/microsoft-calendar.server-sync";

export const Route = createFileRoute("/api/public/hooks/renew-microsoft-subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const xcron = request.headers.get("x-cron-secret");
        const expectedApiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        const expectedCron = process.env.CRON_SECRET ?? "";
        const ok =
          (expectedApiKey && apikey === expectedApiKey) ||
          (expectedCron && xcron === expectedCron);
        if (!ok) return new Response("Unauthorized", { status: 401 });

        const cutoff = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const { data: subs, error } = await supabaseAdmin
          .from("ms_subscriptions")
          .select("subscription_id, user_id, calendar_id")
          .lte("expires_at", cutoff);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; detail?: string }> = [];
        for (const s of subs ?? []) {
          try {
            const renewed = await renewSubscription(s.user_id, s.subscription_id);
            if (renewed) {
              results.push({ id: s.subscription_id, ok: true, detail: `renewed → ${renewed.expires_at}` });
            } else {
              // Subscription is gone — recreate from calendar info
              const { data: cal } = await supabaseAdmin
                .from("calendars")
                .select("external_id")
                .eq("id", s.calendar_id)
                .maybeSingle();
              if (cal?.external_id) {
                await ensureSubscription(s.user_id, s.calendar_id, cal.external_id);
                results.push({ id: s.subscription_id, ok: true, detail: "recreated" });
              } else {
                results.push({ id: s.subscription_id, ok: false, detail: "calendar missing" });
              }
            }
          } catch (e) {
            results.push({ id: s.subscription_id, ok: false, detail: e instanceof Error ? e.message : String(e) });
          }
        }
        return Response.json({ checked: subs?.length ?? 0, results });
      },
    },
  },
});
