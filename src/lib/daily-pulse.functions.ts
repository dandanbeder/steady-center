import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePulseForUser } from "@/lib/daily-pulse-generator.server";

/** Manually generate (or refresh) today's pulse for the signed-in user. */
export const generateMyPulse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ kind: z.enum(["morning", "evening"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;

    // Resolve user context (tz, email, notif prefs) using authed client (RLS-scoped)
    const [{ data: prof }, { data: pref }] = await Promise.all([
      supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
      supabase.from("notification_prefs").select("events, channels, quiet_enabled, quiet_start, quiet_end").eq("user_id", userId).maybeSingle(),
    ]);
    const tz = prof?.timezone || "Africa/Johannesburg";
    const events = (pref?.events ?? {}) as any;
    const channels = (pref?.channels ?? {}) as any;
    const { data: u } = await supabase.auth.getUser();
    const userEmail = u.user?.email ?? null;

    const r = await generatePulseForUser(userId, data.kind, new Date(), {
      allowEmail: channels.email !== false,
      tz,
      userEmail,
      quietEnabled: pref?.quiet_enabled ?? false,
      quietStart: pref?.quiet_start ?? 22,
      quietEnd: pref?.quiet_end ?? 7,
      emailMorning: events.morning_pulse_email === true,
    });
    return r;
  });
