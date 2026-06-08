import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type Row = Record<string, JsonValue>;
type ExportPayload = {
  exported_at: string;
  user_id: string;
  tables: Record<string, Row[]>;
};

// Tables keyed by owner_id
const OWNER_TABLES = [
  "businesses",
  "calendars",
  "events",
  "tasks",
  "notes",
  "meetings",
  "action_items",
  "reminders",
  "inbox_items",
  "daily_pulses",
  "weekly_reports",
  "folders",
  "lists",
] as const;

// Tables keyed by user_id
const USER_TABLES = [
  "ai_prefs",
  "ai_usage",
  "assistant_actions",
  "login_history",
  "memberships",
  "notification_prefs",
  "notifications",
  "time_entries",
  "weekly_goals",
] as const;

/** Export all data owned by the current user as a single JSON object (POPIA s23 / right of access). */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<ExportPayload> => {
    const { supabase, userId } = context;
    const tables: Record<string, Row[]> = {};

    // Profile
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId);
    tables.profiles = (profile ?? []) as unknown as Row[];

    for (const t of OWNER_TABLES) {
      const { data } = await supabase.from(t).select("*").eq("owner_id", userId);
      tables[t] = (data ?? []) as unknown as Row[];
    }
    for (const t of USER_TABLES) {
      const { data } = await supabase.from(t).select("*").eq("user_id", userId);
      tables[t] = (data ?? []) as unknown as Row[];
    }

    // Access requests the user made
    const { data: accessReq } = await supabase
      .from("access_requests")
      .select("*")
      .eq("requester_user_id", userId);
    tables.access_requests = (accessReq ?? []) as unknown as Row[];

    // Item tags involving the user (created by or directed at)
    const { data: tagsByMe } = await supabase
      .from("item_tags")
      .select("*")
      .eq("created_by", userId);
    const { data: tagsForMe } = await supabase
      .from("item_tags")
      .select("*")
      .eq("tagged_user_id", userId);
    const seen = new Set<string>();
    const tags: Row[] = [];
    for (const r of [...(tagsByMe ?? []), ...(tagsForMe ?? [])]) {
      const id = String((r as { id: string }).id);
      if (seen.has(id)) continue;
      seen.add(id);
      tags.push(r as unknown as Row);
    }
    tables.item_tags = tags;

    // Note attachments tied to the user's notes
    const noteIds = (tables.notes ?? []).map((n) => String(n.id));
    if (noteIds.length > 0) {
      const { data } = await supabase
        .from("note_attachments")
        .select("*")
        .in("note_id", noteIds);
      tables.note_attachments = (data ?? []) as unknown as Row[];

      const { data: links } = await supabase
        .from("note_links")
        .select("*")
        .in("from_note_id", noteIds);
      tables.note_links = (links ?? []) as unknown as Row[];
    } else {
      tables.note_attachments = [];
      tables.note_links = [];
    }

    // Task status history for the user's tasks
    const taskIds = (tables.tasks ?? []).map((t) => String(t.id));
    if (taskIds.length > 0) {
      const { data } = await supabase
        .from("task_status_history")
        .select("*")
        .in("task_id", taskIds);
      tables.task_status_history = (data ?? []) as unknown as Row[];
    } else {
      tables.task_status_history = [];
    }

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      tables,
    };
  });
