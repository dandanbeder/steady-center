/**
 * Microsoft / Outlook Calendar sync via Microsoft Graph.
 *
 * Mirrors src/lib/google-calendar.functions.ts. Tokens live server-side only
 * (see microsoft-calendar.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

// ============================================================
// Status / connection
// ============================================================

export const getMicrosoftStatus = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ms_oauth_tokens")
      .select("account_email, needs_reconnect, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      connected: !!data,
      needs_reconnect: !!data?.needs_reconnect,
      account_email: data?.account_email ?? null,
      connected_at: data?.updated_at ?? null,
    };
  });

export const startMicrosoftOAuth = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z.object({ origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { MS_AUTHORITY, MS_SCOPES, getMsRedirectUri, signOAuthState } =
      await import("./microsoft-calendar.server");
    const clientId = process.env.MS_CLIENT_ID;
    if (!clientId) throw new Error("MS_CLIENT_ID secret not configured");
    const redirectUri = getMsRedirectUri(data.origin);
    const state = signOAuthState(context.userId, redirectUri);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: MS_SCOPES,
      state,
      prompt: "select_account",
    });
    return { authorize_url: `${MS_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}` };
  });

/** Called by the OAuth callback page (server-side) to finish the handshake. */
export const completeMicrosoftOAuth = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { verifyOAuthState, exchangeCodeForTokens, persistTokens, emailFromIdToken } =
      await import("./microsoft-calendar.server");
    const parsed = verifyOAuthState(data.state);
    if (!parsed) throw new Error("Invalid or expired OAuth state");
    const tok = await exchangeCodeForTokens(data.code, parsed.redirectUri);
    const { email, tid } = emailFromIdToken(tok.id_token);
    await persistTokens(parsed.userId, tok, email, tid);
    return { ok: true };
  });

export const disconnectMicrosoft = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z.object({ remove_events: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { graphFetch } = await import("./microsoft-calendar.server");

    // Best-effort: delete all Graph subscriptions tied to this user
    const { data: subs } = await supabaseAdmin
      .from("ms_subscriptions")
      .select("subscription_id")
      .eq("user_id", context.userId);
    for (const s of subs ?? []) {
      try {
        await graphFetch(context.userId, `/subscriptions/${s.subscription_id}`, { method: "DELETE" });
      } catch {
        // ignore — token may already be revoked
      }
    }
    await supabaseAdmin.from("ms_subscriptions").delete().eq("user_id", context.userId);

    if (data.remove_events) {
      // Delete synced events + their parent calendars (cascade)
      const { data: cals } = await supabaseAdmin
        .from("calendars")
        .select("id")
        .eq("owner_id", context.userId)
        .eq("provider", "microsoft");
      const ids = (cals ?? []).map((c) => c.id);
      if (ids.length) {
        await supabaseAdmin.from("calendars").delete().in("id", ids);
      }
    }

    await supabaseAdmin.from("ms_oauth_tokens").delete().eq("user_id", context.userId);
    return { ok: true };
  });

// ============================================================
// Calendar list / import
// ============================================================

export const listRemoteMicrosoftCalendars = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { graphJson } = await import("./microsoft-calendar.server");
    const json = await graphJson<{
      value: Array<{ id: string; name: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean }>;
    }>(context.userId, "/me/calendars?$top=200");
    return (json.value ?? [])
      .filter((c) => c.canEdit !== false)
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.hexColor && c.hexColor !== "" ? c.hexColor : "#5B7FFF",
        primary: !!c.isDefaultCalendar,
      }));
  });

export const importMicrosoftCalendar = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z
      .object({
        external_id: z.string().min(1),
        name: z.string().min(1).max(200),
        color: z.string().min(1).max(20),
        business_id: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMicrosoftSyncForCalendar, ensureSubscription } = await import(
      "./microsoft-calendar.server-sync"
    );

    const { data: existing } = await supabase
      .from("calendars")
      .select("id")
      .eq("provider", "microsoft")
      .eq("external_id", data.external_id)
      .maybeSingle();
    if (existing) return { calendar_id: existing.id, alreadyImported: true };

    const { data: row, error } = await supabase
      .from("calendars")
      .insert({
        owner_id: userId,
        business_id: data.business_id,
        name: data.name,
        color: data.color,
        provider: "microsoft",
        external_id: data.external_id,
      })
      .select("id")
      .single();
    if (error) throw error;

    await runMicrosoftSyncForCalendar(supabaseAdmin, userId, row.id, data.external_id, null);
    try {
      await ensureSubscription(userId, row.id, data.external_id);
    } catch (e) {
      // Subscriptions are best-effort — cron still keeps things fresh.
      console.warn("Failed to create MS Graph subscription", e);
    }
    return { calendar_id: row.id, alreadyImported: false };
  });

export const syncMicrosoftCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => z.object({ calendar_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMicrosoftSyncForCalendar } = await import("./microsoft-calendar.server-sync");
    const { data: cal, error } = await supabase
      .from("calendars")
      .select("id, external_id, sync_token, provider, owner_id")
      .eq("id", data.calendar_id)
      .single();
    if (error) throw error;
    if (cal.provider !== "microsoft" || !cal.external_id) {
      throw new Error("Not a Microsoft calendar");
    }
    if (cal.owner_id !== userId) throw new Error("Not authorized");
    return runMicrosoftSyncForCalendar(supabaseAdmin, userId, cal.id, cal.external_id, cal.sync_token);
  });

// ============================================================
// Push event mutations
// ============================================================

export const pushEventToMicrosoft = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { graphJson } = await import("./microsoft-calendar.server");
    const { toMsPayload } = await import("./microsoft-calendar.server-sync");

    const { data: ev, error } = await supabase
      .from("events")
      .select("*, calendar:calendars!inner(provider, external_id, owner_id)")
      .eq("id", data.event_id)
      .is("deleted_at", null)
      .single();
    if (error) throw error;
    const cal = ev.calendar as { provider: string; external_id: string | null; owner_id: string };
    if (cal.provider !== "microsoft" || !cal.external_id) return { skipped: true };

    const body = toMsPayload(ev);
    if (ev.external_id) {
      await graphJson(
        cal.owner_id,
        `/me/calendars/${encodeURIComponent(cal.external_id)}/events/${encodeURIComponent(ev.external_id)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return { updated: true };
    } else {
      const created = await graphJson<{ id: string }>(
        cal.owner_id,
        `/me/calendars/${encodeURIComponent(cal.external_id)}/events`,
        { method: "POST", body: JSON.stringify(body) },
      );
      await supabase
        .from("events")
        .update({ external_id: created.id, source: "microsoft" })
        .eq("id", ev.id);
      return { created: true };
    }
  });

export const deleteEventInMicrosoft = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { graphFetch } = await import("./microsoft-calendar.server");
    const { data: ev, error } = await supabase
      .from("events")
      .select("external_id, calendar:calendars!inner(provider, external_id, owner_id)")
      .eq("id", data.event_id)
      .single();
    if (error) throw error;
    const cal = ev.calendar as { provider: string; external_id: string | null; owner_id: string };
    if (cal.provider !== "microsoft" || !cal.external_id || !ev.external_id) {
      return { skipped: true };
    }
    const res = await graphFetch(
      cal.owner_id,
      `/me/calendars/${encodeURIComponent(cal.external_id)}/events/${encodeURIComponent(ev.external_id)}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`MS Graph delete ${res.status}: ${text.slice(0, 300)}`);
    }
    return { ok: true };
  });
