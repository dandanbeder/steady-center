/**
 * Server-only sync runner for Microsoft Graph calendars.
 *
 * Uses `calendarView/delta` for efficient incremental sync. The current
 * `@odata.deltaLink` is stored in `calendars.sync_token` (reusing the
 * existing column shared with Google).
 *
 * `.server-sync.ts` matches the `*.server.*` glob and is blocked from
 * client bundles.
 */
import { graphFetch, graphJson, MS_GRAPH } from "./microsoft-calendar.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

type MsEvent = {
  id: string;
  "@removed"?: { reason: string };
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  type?: string; // singleInstance | occurrence | exception | seriesMaster
  attendees?: Array<{
    type?: string;
    status?: { response?: string };
    emailAddress?: { name?: string; address?: string };
  }>;
  organizer?: { emailAddress?: { name?: string; address?: string } };
};

function normalize(ev: MsEvent) {
  const start = ev.start?.dateTime;
  const end = ev.end?.dateTime;
  if (!start || !end) return null;
  const allDay = !!ev.isAllDay;
  const toIso = (dt: string, tz: string) => {
    const clean = dt.replace(/\.\d+$/, "");
    if (allDay) return new Date(clean + "Z").toISOString();
    if (!tz || tz === "UTC") return new Date(clean + "Z").toISOString();
    return new Date(clean + "Z").toISOString();
  };
  const organizerEmail = ev.organizer?.emailAddress?.address?.toLowerCase() ?? null;
  const attendees = (ev.attendees ?? [])
    .map((a) => ({
      name: a.emailAddress?.name ?? null,
      email: a.emailAddress?.address ?? null,
    }))
    .filter((a) => (a.name || a.email) && a.email?.toLowerCase() !== organizerEmail);
  return {
    title: ev.subject ?? "(no title)",
    description: ev.body?.content ?? ev.bodyPreview ?? null,
    location: ev.location?.displayName ?? null,
    start_at: toIso(start, ev.start?.timeZone ?? "UTC"),
    end_at: toIso(end, ev.end?.timeZone ?? "UTC"),
    all_day: allDay,
    attendees,
  };
}

export function toMsPayload(ev: {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
}) {
  if (ev.all_day) {
    return {
      subject: ev.title,
      body: ev.description ? { contentType: "text", content: ev.description } : undefined,
      location: ev.location ? { displayName: ev.location } : undefined,
      isAllDay: true,
      start: { dateTime: ev.start_at.slice(0, 10) + "T00:00:00", timeZone: "UTC" },
      end: { dateTime: ev.end_at.slice(0, 10) + "T00:00:00", timeZone: "UTC" },
    };
  }
  return {
    subject: ev.title,
    body: ev.description ? { contentType: "text", content: ev.description } : undefined,
    location: ev.location ? { displayName: ev.location } : undefined,
    start: { dateTime: ev.start_at.replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: ev.end_at.replace(/Z$/, ""), timeZone: "UTC" },
  };
}

/**
 * Run a delta sync for a single Microsoft calendar.
 * - On first run (no sync_token), uses calendarView/delta with a 1-month
 *   look-back and 12-month look-ahead window.
 * - On subsequent runs, follows the saved @odata.deltaLink.
 */
export async function runMicrosoftSyncForCalendar(
  supabaseAdmin: Sb,
  userId: string,
  localCalendarId: string,
  externalCalendarId: string,
  syncToken: string | null,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const sb: Sb = supabaseAdmin;
  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  const { data: calRow } = await sb
    .from("calendars")
    .select("owner_id, business_id")
    .eq("id", localCalendarId)
    .maybeSingle();
  const ownerId: string | undefined = calRow?.owner_id;
  const businessId: string | null = calRow?.business_id ?? null;
  if (!ownerId) throw new Error(`Calendar ${localCalendarId} not found`);

  // Build initial URL
  let url: string;
  if (syncToken) {
    url = syncToken; // full deltaLink with $deltatoken
  } else {
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const end = new Date();
    end.setMonth(end.getMonth() + 12);
    const params = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
    });
    url = `${MS_GRAPH}/me/calendars/${encodeURIComponent(externalCalendarId)}/calendarView/delta?${params.toString()}`;
  }

  let nextDeltaLink: string | null = null;
  for (let page = 0; page < 50; page++) {
    let json: {
      value?: MsEvent[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    try {
      json = await graphJson(userId, url, {
        method: "GET",
        headers: {
          // Ask Graph to normalize all date-times to UTC so we don't have to
          // do per-event tz math on the worker.
          Prefer: 'odata.maxpagesize=200, outlook.timezone="UTC"',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // delta token expired (410) → restart full sync
      if (msg.includes("410") && syncToken) {
        return runMicrosoftSyncForCalendar(sb, userId, localCalendarId, externalCalendarId, null);
      }
      throw err;
    }

    for (const ev of json.value ?? []) {
      // Skip series-master rows; we sync expanded occurrences from calendarView.
      if (ev.type === "seriesMaster") continue;

      if (ev["@removed"] || ev.isCancelled) {
        const { error } = await sb
          .from("events")
          .update({ deleted_at: new Date().toISOString() })
          .eq("calendar_id", localCalendarId)
          .eq("external_id", ev.id)
          .is("deleted_at", null);
        if (!error) deleted++;
        continue;
      }
      const norm = normalize(ev);
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
          source: "microsoft",
          external_id: ev.id,
        });
        if (!error) inserted++;
      }
    }

    if (json["@odata.nextLink"]) {
      url = json["@odata.nextLink"];
    } else {
      nextDeltaLink = json["@odata.deltaLink"] ?? null;
      break;
    }
  }

  await sb
    .from("calendars")
    .update({
      sync_token: nextDeltaLink,
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
      last_sync_error_at: null,
    })
    .eq("id", localCalendarId);


  return { inserted, updated, deleted };
}

// ============================================================
// Graph change-notification subscriptions
// ============================================================

function webhookBaseUrl(): string {
  // Stable published URL, used in subscription registration.
  return (
    process.env.PUBLIC_APP_URL ||
    "https://project--sfxrqznrfaeajhzmofan.lovable.app"
  );
}

export async function ensureSubscription(
  userId: string,
  localCalendarId: string,
  externalCalendarId: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { randomBytes } = await import("crypto");

  // Drop any stale subscription for this calendar
  const { data: prior } = await supabaseAdmin
    .from("ms_subscriptions")
    .select("subscription_id")
    .eq("calendar_id", localCalendarId);
  for (const p of prior ?? []) {
    try {
      await graphFetch(userId, `/subscriptions/${p.subscription_id}`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }
  await supabaseAdmin.from("ms_subscriptions").delete().eq("calendar_id", localCalendarId);

  const clientState = randomBytes(24).toString("hex");
  // Personal accounts cap at ~4230 min (≈3 days) for calendar events.
  const expiry = new Date(Date.now() + 60 * 60 * 24 * 2 * 1000).toISOString(); // 2 days

  const body = {
    changeType: "created,updated,deleted",
    notificationUrl: `${webhookBaseUrl()}/api/public/hooks/microsoft-graph-webhook`,
    resource: `/me/calendars/${externalCalendarId}/events`,
    expirationDateTime: expiry,
    clientState,
  };

  const res = await graphFetch(userId, "/subscriptions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph subscription create ${res.status}: ${text.slice(0, 300)}`);
  }
  const created = (await res.json()) as { id: string; expirationDateTime: string };
  await supabaseAdmin.from("ms_subscriptions").insert({
    user_id: userId,
    calendar_id: localCalendarId,
    subscription_id: created.id,
    client_state: clientState,
    resource: body.resource,
    expires_at: created.expirationDateTime,
  });
}

export async function renewSubscription(
  userId: string,
  subscriptionId: string,
): Promise<{ expires_at: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const newExpiry = new Date(Date.now() + 60 * 60 * 24 * 2 * 1000).toISOString();
  const res = await graphFetch(userId, `/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime: newExpiry }),
  });
  if (!res.ok) {
    // 404 → subscription gone; caller can recreate.
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`Graph subscription renew ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { expirationDateTime: string };
  await supabaseAdmin
    .from("ms_subscriptions")
    .update({ expires_at: json.expirationDateTime })
    .eq("subscription_id", subscriptionId);
  return { expires_at: json.expirationDateTime };
}
