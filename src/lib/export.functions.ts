import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type Row = Record<string, JsonValue>;
type ExportPayload = {
  exported_at: string;
  user_id: string;
  tables: Record<string, Row[]>;
};

const OWNER_TABLES = [
  "businesses",
  "calendars",
  "events",
  "tasks",
  "notes",
  "meetings",
  "weekly_reports",
] as const;
const USER_TABLES = ["weekly_goals", "time_entries"] as const;

/** Export all data owned by the current user as a single JSON object. */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExportPayload> => {
    const { supabase, userId } = context;
    const tables: Record<string, Row[]> = {};

    for (const t of OWNER_TABLES) {
      const { data } = await supabase.from(t).select("*").eq("owner_id", userId);
      tables[t] = (data ?? []) as unknown as Row[];
    }
    for (const t of USER_TABLES) {
      const { data } = await supabase.from(t).select("*").eq("user_id", userId);
      tables[t] = (data ?? []) as unknown as Row[];
    }

    // Note attachments tied to the user's notes
    const noteIds = (tables.notes ?? []).map((n) => String(n.id));
    if (noteIds.length > 0) {
      const { data } = await supabase
        .from("note_attachments")
        .select("*")
        .in("note_id", noteIds);
      tables.note_attachments = (data ?? []) as unknown as Row[];
    } else {
      tables.note_attachments = [];
    }

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      tables,
    };
  });
