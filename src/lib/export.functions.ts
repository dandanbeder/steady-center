import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Export all data owned by the current user as a single JSON object. */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const tables = [
      "businesses",
      "calendars",
      "events",
      "tasks",
      "notes",
      "note_attachments",
      "meetings",
      "weekly_goals",
      "weekly_reports",
      "time_entries",
    ] as const;

    const result: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      user_id: userId,
    };

    for (const t of tables) {
      const { data, error } = await supabase.from(t).select("*").eq("owner_id", userId);
      if (error) {
        // some tables use user_id instead of owner_id
        const retry = await supabase.from(t).select("*").eq("user_id", userId);
        result[t] = retry.data ?? [];
      } else {
        result[t] = data ?? [];
      }
    }

    return result;
  });
