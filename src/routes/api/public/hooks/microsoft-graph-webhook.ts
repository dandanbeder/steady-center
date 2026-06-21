/**
 * Microsoft Graph change-notification webhook.
 *
 * On subscription creation Graph sends a GET/POST with `?validationToken=...`
 * which MUST be echoed back as text/plain within 10s.
 *
 * For real notifications: validates each notification's `clientState` against
 * the value we stored, then enqueues a delta sync for the affected calendar.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runMicrosoftSyncForCalendar } from "@/lib/microsoft-calendar.server-sync";

type Notification = {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
};

export const Route = createFileRoute("/api/public/hooks/microsoft-graph-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Validation handshake (Graph sends a GET in some flows)
        const url = new URL(request.url);
        const token = url.searchParams.get("validationToken");
        if (token) {
          return new Response(token, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return new Response("ok");
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("validationToken");
        if (token) {
          // Initial subscription validation
          return new Response(token, { status: 200, headers: { "Content-Type": "text/plain" } });
        }

        let body: { value?: Notification[] };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const notifications = body.value ?? [];
        // Always 202 promptly; do work best-effort.
        // Dedupe by subscriptionId to avoid running the same sync multiple
        // times when a batch contains many changes.
        const seen = new Set<string>();
        const toSync: Notification[] = [];
        for (const n of notifications) {
          if (!n.subscriptionId || seen.has(n.subscriptionId)) continue;
          seen.add(n.subscriptionId);
          toSync.push(n);
        }

        for (const n of toSync) {
          const { data: sub } = await supabaseAdmin
            .from("ms_subscriptions")
            .select("subscription_id, client_state, user_id, calendar_id")
            .eq("subscription_id", n.subscriptionId)
            .maybeSingle();
          if (!sub) continue;
          if (n.clientState && n.clientState !== sub.client_state) {
            // Spoofed notification, ignore
            continue;
          }
          const { data: cal } = await supabaseAdmin
            .from("calendars")
            .select("external_id, sync_token")
            .eq("id", sub.calendar_id)
            .maybeSingle();
          if (!cal?.external_id) continue;
          try {
            await runMicrosoftSyncForCalendar(
              supabaseAdmin,
              sub.user_id,
              sub.calendar_id,
              cal.external_id,
              cal.sync_token,
            );
          } catch (e) {
            console.error("graph webhook sync failed", n.subscriptionId, e);
          }
        }

        return new Response(null, { status: 202 });
      },
    },
  },
});
