// Authenticated + active-user gate. Chains requireSupabaseAuth and then
// rejects suspended or scheduled-for-deletion accounts at every server-fn
// entry point. Use in place of requireSupabaseAuth on every protected fn.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireActiveUser = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("status, deletion_scheduled_at")
      .eq("id", userId)
      .maybeSingle();

    if (error || !profile) {
      throw new Error("Unauthorized");
    }
    if (profile.status !== "active") {
      throw new Error("Account suspended");
    }
    if (
      profile.deletion_scheduled_at &&
      new Date(profile.deletion_scheduled_at).getTime() <= Date.now()
    ) {
      throw new Error("Account deleted");
    }

    return next();
  });
