import { supabase } from "@/integrations/supabase/client";
import { pushEventToGoogle, deleteEventInGoogle } from "@/lib/google-calendar.functions";



export type Calendar = {
  id: string;
  owner_id: string;
  business_id: string | null;
  name: string;
  color: string;
  provider: string;
  external_id: string | null;
  created_at: string;
  last_synced_at: string | null;
};


export type EventRow = {
  id: string;
  owner_id: string;
  calendar_id: string;
  business_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  is_meeting: boolean;
  source: string;
  external_id: string | null;
  created_at: string;
  sync_status?: string | null;
  sync_error?: string | null;
};

export async function listCalendars(): Promise<Calendar[]> {
  const { data, error } = await supabase
    .from("calendars")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createCalendar(input: {
  name: string;
  color: string;
  business_id: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("calendars").insert({
    name: input.name,
    color: input.color,
    business_id: input.business_id,
    owner_id: u.user.id,
  });
  if (error) throw error;
}

export async function updateCalendar(
  id: string,
  patch: Partial<Pick<Calendar, "name" | "color">>,
) {
  const { error } = await supabase.from("calendars").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCalendar(id: string) {
  const { error } = await supabase.from("calendars").delete().eq("id", id);
  if (error) throw error;
}

export async function listEvents(rangeStart?: Date, rangeEnd?: Date): Promise<EventRow[]> {
  let q = supabase.from("events").select("*").order("start_at", { ascending: true });
  if (rangeStart) q = q.gte("end_at", rangeStart.toISOString());
  if (rangeEnd) q = q.lte("start_at", rangeEnd.toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createEvent(input: {
  calendar_id: string;
  business_id: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  source?: string;
  external_id?: string | null;
}): Promise<{ id: string; syncWarning: string | null }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");

  // Determine if parent calendar is provider-synced so we mark sync_status correctly.
  const { data: cal } = await supabase
    .from("calendars")
    .select("provider")
    .eq("id", input.calendar_id)
    .maybeSingle();
  const isSynced = cal?.provider === "google";

  const { data: inserted, error } = await supabase
    .from("events")
    .insert({
      ...input,
      source: input.source ?? "manual",
      owner_id: u.user.id,
      sync_status: isSynced ? "pending" : "local",
    })
    .select("id, calendar_id")
    .single();
  if (error) throw error;

  const syncWarning = await maybePushToGoogle(inserted.id, inserted.calendar_id);
  return { id: inserted.id, syncWarning };
}

export async function updateEvent(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    location: string | null;
    start_at: string;
    end_at: string;
    all_day: boolean;
    is_meeting: boolean;
  }>,
): Promise<{ syncWarning: string | null }> {
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", id)
    .select("id, calendar_id")
    .single();
  if (error) throw error;
  const syncWarning = await maybePushToGoogle(data.id, data.calendar_id);
  return { syncWarning };
}

export async function bulkInsertEvents(rows: Array<Omit<EventRow, "id" | "owner_id" | "created_at" | "is_meeting"> & { is_meeting?: boolean }>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");

  // Dedupe within the payload by (calendar_id, external_id, start_at)
  // so a single .ics that lists the same instance twice doesn't insert twice.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.external_id) return true;
    const k = `${r.calendar_id}|${r.external_id}|${r.start_at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const payload = deduped.map((r) => ({ ...r, owner_id: u.user!.id }));
  // Upsert against the partial unique index so re-importing the same
  // recurring event is a no-op instead of throwing.
  const { error } = await supabase
    .from("events")
    .upsert(payload, { onConflict: "calendar_id,external_id,start_at", ignoreDuplicates: true });
  if (error) throw error;
  return deduped.length;
}


export async function deleteEvent(id: string) {
  // Delete remote first (RLS-scoped on the server), then local.
  try {
    await deleteEventInGoogle({ data: { event_id: id } });
  } catch (e) {
    console.warn("Failed to delete remote Google event", e);
  }
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

/** Returns null on success/skip, or a friendly warning string on failure. */
async function maybePushToGoogle(eventId: string, calendarId: string): Promise<string | null> {
  const { data: cal } = await supabase
    .from("calendars")
    .select("provider")
    .eq("id", calendarId)
    .maybeSingle();
  if (cal?.provider !== "google") return null;
  try {
    await pushEventToGoogle({ data: { event_id: eventId } });
    await supabase
      .from("events")
      .update({ sync_status: "synced", sync_error: null })
      .eq("id", eventId);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reconnect = /401|403|invalid_grant|unauthorized|not configured/i.test(msg);
    const friendly = reconnect
      ? "Event saved locally, but Google sync failed — reconnect Google in Settings › Connections."
      : `Event saved locally, but Google sync failed: ${msg.slice(0, 200)}`;
    await supabase
      .from("events")
      .update({ sync_status: "failed", sync_error: friendly })
      .eq("id", eventId);
    console.warn("Failed to push event to Google", e);
    return friendly;
  }
}

/** Manually retry pushing an event to its provider. */
export async function retryEventSync(eventId: string): Promise<{ syncWarning: string | null }> {
  const { data: ev, error } = await supabase
    .from("events")
    .select("id, calendar_id")
    .eq("id", eventId)
    .single();
  if (error) throw error;
  await supabase
    .from("events")
    .update({ sync_status: "pending", sync_error: null })
    .eq("id", eventId);
  const syncWarning = await maybePushToGoogle(ev.id, ev.calendar_id);
  return { syncWarning };
}


// ---------- ICS parser ----------

function unfold(text: string) {
  // RFC5545: lines starting with space/tab continue previous line
  return text.replace(/\r?\n[ \t]/g, "");
}

function unescapeText(v: string) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcsDate(raw: string): { date: Date; allDay: boolean } {
  // Accept forms: 20240131, 20240131T093000, 20240131T093000Z, with TZID param stripped
  const v = raw.trim();
  const allDay = /^\d{8}$/.test(v);
  if (allDay) {
    const y = +v.slice(0, 4), m = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    return { date: new Date(Date.UTC(y, m, d)), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: new Date(v), allDay: false };
  const [, Y, Mo, D, h, mi, s, z] = m;
  if (z === "Z") {
    return { date: new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s)), allDay: false };
  }
  return { date: new Date(+Y, +Mo - 1, +D, +h, +mi, +s), allDay: false };
}

export type ParsedIcsEvent = {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  external_id: string | null;
};

export function parseIcs(text: string): ParsedIcsEvent[] {
  const unfolded = unfold(text);
  const lines = unfolded.split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];
  let cur: Record<string, string> | null = null;
  let curAllDay = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      curAllDay = false;
    } else if (line === "END:VEVENT") {
      if (cur && cur.DTSTART && cur.SUMMARY) {
        const s = parseIcsDate(cur.DTSTART);
        const e = cur.DTEND ? parseIcsDate(cur.DTEND) : { date: new Date(s.date.getTime() + 60 * 60 * 1000), allDay: s.allDay };
        events.push({
          title: unescapeText(cur.SUMMARY),
          description: cur.DESCRIPTION ? unescapeText(cur.DESCRIPTION) : null,
          location: cur.LOCATION ? unescapeText(cur.LOCATION) : null,
          start_at: s.date.toISOString(),
          end_at: e.date.toISOString(),
          all_day: s.allDay || curAllDay,
          external_id: cur.UID ?? null,
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const [key, ...params] = left.split(";");
      if (params.some((p) => p.toUpperCase() === "VALUE=DATE")) curAllDay = true;
      cur[key.toUpperCase()] = value;
    }
  }
  return events;
}
