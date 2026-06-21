import { supabase } from "@/integrations/supabase/client";

export type HourFormat = "12h" | "24h";
export type WeekStartDay = 0 | 1; // 0 = Sunday, 1 = Monday
export type DefaultLanding = "today" | "calendar";

export type GeneralPrefs = {
  full_name: string;
  email: string;
  timezone: string;
  hour_format: HourFormat;
  week_start_day: WeekStartDay;
  default_landing: DefaultLanding;
};

/**
 * Single source of truth for the global "General" preferences that drive
 * Calendar, reminders, schedules, and the post-login landing page. Reads
 * from the user's own profile row under existing RLS (profile policies
 * already scope to `auth.uid()`).
 */
export async function getGeneralPrefs(): Promise<GeneralPrefs> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, timezone, hour_format, week_start_day, default_landing")
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    full_name: data?.full_name ?? "",
    email: u.user.email ?? "",
    timezone: data?.timezone ?? "Africa/Johannesburg",
    hour_format: ((data?.hour_format as HourFormat) ?? "24h"),
    week_start_day: ((data?.week_start_day as WeekStartDay) ?? 1),
    default_landing: ((data?.default_landing as DefaultLanding) ?? "today"),
  };
}

export async function updateGeneralPrefs(
  patch: Partial<Omit<GeneralPrefs, "email">>,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", u.user.id);
  if (error) throw error;
}
