import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateForUser } from "@/lib/weekly-report-generator.server";

/** Generate a weekly report for the current user, for the trailing 7 days. */
export const generateWeeklyReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "weekly_reports");
    const weekEnd = new Date();
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);
    const id = await generateForUser(userId, weekStart, weekEnd);
    return { id };
  });
