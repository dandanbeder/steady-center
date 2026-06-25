// Team calendar overlay.
//
// Returns events/meetings/tasks in a given business that the caller can see
// AND are owned by other members — i.e. items teammates have shared into the
// team space. Private items never appear: every read goes through the
// RLS-scoped `context.supabase`, whose policies route through `can_access`
// (owner OR share grant OR business membership). Journal notes are never
// surfaced (notes aren't returned here, and `can_access` blocks 'journal'
// note_type anyway).
//
// One access grant, two surfaces: the same `shares` / membership chain that
// powers "Shared with me" (listSharedWithMeResources) powers this view.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

// Stable per-user palette — deterministic colour from the user id so a
// teammate's events stay the same colour across reloads and surfaces.
const MEMBER_PALETTE = [
  "#7A8471", "#A86B5C", "#5C7AA8", "#B58E3F", "#6B8E7A",
  "#8E6B8A", "#3F7A8E", "#A85C7A", "#5CA86B", "#8A5C3F",
];
function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return MEMBER_PALETTE[Math.abs(h) % MEMBER_PALETTE.length];
}

export type TeamOverlayItem = {
  id: string;
  source: "event" | "meeting" | "task";
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  business_id: string;
  team_owner_id: string;
  team_owner_name: string | null;
  team_color: string;
  // Extra cues for click-through
  meeting_id?: string;
  task_id?: string;
  event_id?: string;
};

export type TeamMember = {
  user_id: string;
  full_name: string | null;
  color: string;
};

export type TeamOverlay = {
  members: TeamMember[];
  items: TeamOverlayItem[];
};

export const listTeamOverlay = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z
      .object({
        businessId: z.string().uuid(),
        rangeStart: z.string(),
        rangeEnd: z.string(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TeamOverlay> => {
    const { supabase, userId } = context;
    const { businessId, rangeStart, rangeEnd } = data;

    // Caller must have some access to the business (membership OR a business
    // share grant). RLS would already block reads otherwise — this gives a
    // cleaner empty payload + avoids three pointless queries.
    const [{ data: mem }, { data: bizShare }] = await Promise.all([
      supabase
        .from("memberships")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("shares")
        .select("id")
        .eq("resource_type", "business")
        .eq("resource_id", businessId)
        .eq("grantee_user_id", userId)
        .maybeSingle(),
    ]);
    if (!mem && !bizShare) return { members: [], items: [] };

    // Pull team items in the window, owned by other users. RLS still gates
    // every row — we double-filter here so we never accidentally surface
    // someone's PERSONAL event that happens to be tagged to this business.
    const [evRes, mtRes, tkRes] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, start_at, end_at, all_day, owner_id, business_id")
        .eq("business_id", businessId)
        .neq("owner_id", userId)
        .is("deleted_at", null)
        .gte("end_at", rangeStart)
        .lte("start_at", rangeEnd),
      supabase
        .from("meetings")
        .select("id, title, scheduled_at, owner_id, business_id")
        .eq("business_id", businessId)
        .neq("owner_id", userId)
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", rangeStart)
        .lte("scheduled_at", rangeEnd),
      supabase
        .from("tasks")
        .select("id, title, due_at, estimated_minutes, owner_id, business_id, status")
        .eq("business_id", businessId)
        .neq("owner_id", userId)
        .not("due_at", "is", null)
        .gte("due_at", rangeStart)
        .lte("due_at", rangeEnd),
    ]);

    const events = evRes.data ?? [];
    const meetings = mtRes.data ?? [];
    const tasks = tkRes.data ?? [];

    const ownerIds = Array.from(
      new Set<string>([
        ...events.map((e) => e.owner_id as string),
        ...meetings.map((m) => m.owner_id as string),
        ...tasks.map((t) => t.owner_id as string),
      ]),
    );

    const { data: profs } = ownerIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const nameByUser = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));

    const members: TeamMember[] = ownerIds.map((uid) => ({
      user_id: uid,
      full_name: nameByUser.get(uid) ?? null,
      color: colorForUser(uid),
    }));

    const items: TeamOverlayItem[] = [];

    for (const e of events) {
      const ownerId = e.owner_id as string;
      items.push({
        id: `event:${e.id}`,
        source: "event",
        event_id: e.id as string,
        title: (e.title as string) || "Untitled",
        start_at: e.start_at as string,
        end_at: e.end_at as string,
        all_day: !!e.all_day,
        business_id: businessId,
        team_owner_id: ownerId,
        team_owner_name: nameByUser.get(ownerId) ?? null,
        team_color: colorForUser(ownerId),
      });
    }

    for (const m of meetings) {
      const ownerId = m.owner_id as string;
      const start = new Date(m.scheduled_at as string);
      const end = new Date(start.getTime() + 60 * 60_000); // default 60min
      items.push({
        id: `meeting:${m.id}`,
        source: "meeting",
        meeting_id: m.id as string,
        title: (m.title as string) || "Meeting",
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
        business_id: businessId,
        team_owner_id: ownerId,
        team_owner_name: nameByUser.get(ownerId) ?? null,
        team_color: colorForUser(ownerId),
      });
    }

    for (const t of tasks) {
      const ownerId = t.owner_id as string;
      const start = new Date(t.due_at as string);
      const mins = Math.max(15, (t.estimated_minutes as number | null) ?? 30);
      const end = new Date(start.getTime() + mins * 60_000);
      items.push({
        id: `task:${t.id}`,
        source: "task",
        task_id: t.id as string,
        title: (t.title as string) || "Task",
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
        business_id: businessId,
        team_owner_id: ownerId,
        team_owner_name: nameByUser.get(ownerId) ?? null,
        team_color: colorForUser(ownerId),
      });
    }

    return { members, items };
  });
