/**
 * Google Calendar sync via the Lovable connector gateway.
 *
 * Server-only. Runs as the signed-in user for app actions (import/sync/push),
 * and as the service role from the cron endpoint (see src/routes/api/public/hooks/sync-calendars.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

function gatewayHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const googleKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!googleKey) throw new Error("GOOGLE_CALENDAR_API_KEY is not configured, connect Google Calendar first.");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": googleKey,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

async function gFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...gatewayHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------- Remote calendar list ----------------

export const listRemoteGoogleCalendars = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async () => {
    const json = await gFetch("/users/me/calendarList?minAccessRole=writer&maxResults=250");
    const items: Array<{ id: string; summary: string; backgroundColor?: string; primary?: boolean }> = json?.items ?? [];
    return items.map((c) => ({
      id: c.id,
      name: c.summary,
      color: c.backgroundColor ?? "#7A8471",
      primary: !!c.primary,
    }));
  });

// ---------------- Import a remote calendar ----------------

export const importGoogleCalendar = createServerFn({ method: "POST" })
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
    // Avoid duplicates: a Google calendar can be imported once per user.
    const { data: existing } = await supabase
      .from("calendars")
      .select("id")
      .eq("provider", "google")
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
        provider: "google",
        external_id: data.external_id,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Kick off the first full sync inline so the user sees events right away.
    await runSyncForCalendar(supabase, row.id, data.external_id, null);
    return { calendar_id: row.id, alreadyImported: false };
  });

// ---------------- Sync a single calendar (callable from UI) ----------------

export const syncGoogleCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => z.object({ calendar_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: cal, error } = await supabase
      .from("calendars")
      .select("id, external_id, sync_token, provider")
      .eq("id", data.calendar_id)
      .single();
    if (error) throw error;
    if (cal.provider !== "google" || !cal.external_id) {
      throw new Error("Not a Google calendar");
    }
    const result = await runSyncForCalendar(supabase, cal.id, cal.external_id, cal.sync_token);
    return result;
  });

// ---------------- Disconnect a single Google calendar ----------------
//
// The Google connector uses a workspace-shared API key (gateway), so there
// is no per-user OAuth token to revoke here. "Disconnect" means: stop two-way
// sync for THIS calendar, and either keep already-synced events (convert the
// calendar row to a local 'manual' calendar) or remove them (delete the row,
// which cascades to events). All scoped by RLS to the signed-in user.
export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z
      .object({
        calendar_id: z.string().uuid(),
        remove_events: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cal, error } = await supabase
      .from("calendars")
      .select("id, owner_id, provider")
      .eq("id", data.calendar_id)
      .single();
    if (error) throw error;
    if (cal.owner_id !== userId) throw new Error("Not authorized");
    if (cal.provider !== "google") throw new Error("Not a Google calendar");

    if (data.remove_events) {
      const { error: delErr } = await supabase
        .from("calendars")
        .delete()
        .eq("id", cal.id);
      if (delErr) throw delErr;
    } else {
      const { error: updErr } = await supabase
        .from("calendars")
        .update({
          provider: "manual",
          external_id: null,
          sync_token: null,
          last_synced_at: null,
        })
        .eq("id", cal.id);
      if (updErr) throw updErr;
    }

    // Audit log: disconnect is a security-relevant action.
    await supabase.from("analytics_events").insert({
      user_id: userId,
      type: "calendar_disconnect",
      metadata: {
        provider: "google",
        calendar_id: cal.id,
        removed_events: data.remove_events,
      },
    });

    return { ok: true, removed_events: data.remove_events };
  });

// ---------------- Push event mutations to Google ----------------

const eventPushInput = z.object({
  event_id: z.string().uuid(),
});

export const pushEventToGoogle = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => eventPushInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ev, error } = await supabase
      .from("events")
      .select("*, calendar:calendars!inner(provider, external_id)")
      .eq("id", data.event_id)
      .is("deleted_at", null)
      .single();
    if (error) throw error;
    const cal = ev.calendar as { provider: string; external_id: string | null };
    if (cal.provider !== "google" || !cal.external_id) {
      return { skipped: true };
    }

    const body = toGooglePayload(ev);

    if (ev.external_id) {
      // Update
      await gFetch(
        `/calendars/${encodeURIComponent(cal.external_id)}/events/${encodeURIComponent(ev.external_id)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return { updated: true };
    } else {
      // Create
      const created: { id: string } = await gFetch(
        `/calendars/${encodeURIComponent(cal.external_id)}/events`,
        { method: "POST", body: JSON.stringify(body) },
      );
      await supabase
        .from("events")
        .update({ external_id: created.id, source: "google" })
        .eq("id", ev.id);
      return { created: true };
    }
  });

export const deleteEventInGoogle = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z.object({ event_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS-scoped lookup: only succeeds if the caller can access this event.
    // Prevents authenticated users from deleting arbitrary Google events
    // by passing raw external IDs to the shared connector credentials.
    const { data: ev, error } = await supabase
      .from("events")
      .select("external_id, calendar:calendars!inner(provider, external_id)")
      .eq("id", data.event_id)
      .single();
    if (error) throw error;
    const cal = ev.calendar as { provider: string; external_id: string | null };
    if (cal.provider !== "google" || !cal.external_id || !ev.external_id) {
      return { skipped: true };
    }
    await gFetch(
      `/calendars/${encodeURIComponent(cal.external_id)}/events/${encodeURIComponent(ev.external_id)}`,
      { method: "DELETE" },
    );
    return { ok: true };
  });

// ---------------- Internal sync runner (shared by UI + cron) ----------------

type EventStub = {
  id: string;
  status?: string;
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string }>;
};

// We accept any Supabase-like client (auth client from middleware, or admin).
// Use a permissive type to keep both shapes assignable without ceremony.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncSupabase = any;

export async function runSyncForCalendar(
  supabase: SyncSupabase,
  localCalendarId: string,
  externalCalendarId: string,
  syncToken: string | null,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const sb: SyncSupabase = supabase;
  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let useSyncToken = !!syncToken;

  // Look up the parent calendar once (we need owner_id + business_id for inserts).
  const { data: calRow } = await sb
    .from("calendars")
    .select("owner_id, business_id")
    .eq("id", localCalendarId)
    .maybeSingle();
  const ownerId: string | undefined = calRow?.owner_id;
  const businessId: string | null = calRow?.business_id ?? null;
  if (!ownerId) {
    throw new Error(`Calendar ${localCalendarId} not found or missing owner`);
  }

  // Loop pages
  for (let page = 0; page < 25; page++) {
    const params = new URLSearchParams();
    params.set("singleEvents", "true");
    params.set("maxResults", "250");
    if (useSyncToken && syncToken && !pageToken) {
      params.set("syncToken", syncToken);
    } else if (!useSyncToken) {
      // Initial / reset sync: limit to a sane window
      const from = new Date();
      from.setMonth(from.getMonth() - 1);
      params.set("timeMin", from.toISOString());
    }
    if (pageToken) params.set("pageToken", pageToken);

    let json: { items?: EventStub[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      json = await gFetch(
        `/calendars/${encodeURIComponent(externalCalendarId)}/events?${params.toString()}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes(" 410:") && useSyncToken) {
        // Sync token expired, restart with full sync
        useSyncToken = false;
        pageToken = null;
        continue;
      }
      throw err;
    }

    const items = json.items ?? [];
    for (const ev of items) {
      if (ev.status === "cancelled") {
        // Soft-delete locally to mirror the remote cancellation.
        const { error } = await sb
          .from("events")
          .update({ deleted_at: new Date().toISOString() })
          .eq("calendar_id", localCalendarId)
          .eq("external_id", ev.id)
          .is("deleted_at", null);
        if (!error) deleted++;
        continue;
      }
      const norm = fromGoogleEvent(ev);
      if (!norm) continue;

      const { data: found } = await sb
        .from("events")
        .select("id")
        .eq("calendar_id", localCalendarId)
        .eq("external_id", ev.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (found) {
        const { error } = await sb
          .from("events")
          .update({
            title: norm.title,
            description: norm.description,
            location: norm.location,
            start_at: norm.start_at,
            end_at: norm.end_at,
            all_day: norm.all_day,
            attendees: norm.attendees,
          })
          .eq("id", found.id);
        if (!error) updated++;
      } else {
        const { error } = await sb.from("events").insert({
          owner_id: ownerId,
          calendar_id: localCalendarId,
          business_id: businessId,
          title: norm.title,
          description: norm.description,
          location: norm.location,
          start_at: norm.start_at,
          end_at: norm.end_at,
          all_day: norm.all_day,
          attendees: norm.attendees,
          source: "google",
          external_id: ev.id,
        });
        if (!error) inserted++;
      }
    }

    if (json.nextPageToken) {
      pageToken = json.nextPageToken;
    } else {
      nextSyncToken = json.nextSyncToken ?? null;
      break;
    }
  }

  // Save the new sync token + timestamp
  await sb
    .from("calendars")
    .update({ sync_token: nextSyncToken, last_synced_at: new Date().toISOString() })
    .eq("id", localCalendarId);

  return { inserted, updated, deleted };
}


// ---------------- Helpers ----------------

function fromGoogleEvent(ev: EventStub) {
  const allDay = !!(ev.start?.date && !ev.start?.dateTime);
  const start = ev.start?.dateTime ?? ev.start?.date;
  const end = ev.end?.dateTime ?? ev.end?.date;
  if (!start || !end) return null;
  const attendees = (ev.attendees ?? [])
    .filter((a) => !a.self)
    .map((a) => ({ name: a.displayName ?? null, email: a.email ?? null }))
    .filter((a) => a.name || a.email);
  return {
    title: ev.summary ?? "(no title)",
    description: ev.description ?? null,
    location: ev.location ?? null,
    start_at: allDay ? new Date(start + "T00:00:00Z").toISOString() : new Date(start).toISOString(),
    end_at: allDay ? new Date(end + "T00:00:00Z").toISOString() : new Date(end).toISOString(),
    all_day: allDay,
    attendees,
  };
}

function toGooglePayload(ev: {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
}) {
  if (ev.all_day) {
    const startDate = ev.start_at.slice(0, 10);
    const endDate = ev.end_at.slice(0, 10);
    return {
      summary: ev.title,
      description: ev.description ?? undefined,
      location: ev.location ?? undefined,
      start: { date: startDate },
      end: { date: endDate },
    };
  }
  return {
    summary: ev.title,
    description: ev.description ?? undefined,
    location: ev.location ?? undefined,
    start: { dateTime: ev.start_at },
    end: { dateTime: ev.end_at },
  };
}
