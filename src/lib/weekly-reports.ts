import { supabase } from "@/integrations/supabase/client";
import type {
  ReportMetrics,
  ReportNarrative,
  PerBusinessMetrics,
} from "@/lib/weekly-report-generator.server";

export type { ReportMetrics, ReportNarrative, PerBusinessMetrics };

export type WeeklyReport = {
  id: string;
  owner_id: string;
  business_id: string | null;
  week_start: string;
  week_end: string;
  metrics: ReportMetrics;
  narrative: ReportNarrative;
  created_at: string;
};

export type WeeklyReviewPrefs = {
  weekly_review_day: number;
  weekly_review_hour: number;
  weekly_review_enabled: boolean;
  timezone: string;
};

export async function listWeeklyReports(): Promise<WeeklyReport[]> {
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .order("week_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WeeklyReport[];
}

export async function getWeeklyReport(id: string): Promise<WeeklyReport | null> {
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WeeklyReport | null) ?? null;
}

export async function updateWeeklyReviewPrefs(p: WeeklyReviewPrefs) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update(p).eq("id", u.user.id);
  if (error) throw error;
}

export async function getWeeklyReviewPrefs(): Promise<WeeklyReviewPrefs> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("weekly_review_day, weekly_review_hour, weekly_review_enabled, timezone")
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    weekly_review_day: data?.weekly_review_day ?? 5,
    weekly_review_hour: data?.weekly_review_hour ?? 16,
    weekly_review_enabled: data?.weekly_review_enabled ?? true,
    timezone: data?.timezone ?? "Africa/Johannesburg",
  };
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function reportStatus(r: WeeklyReport): "green" | "gold" {
  const rate = r.metrics?.overall?.completion_rate ?? 0;
  return rate >= 0.7 ? "green" : "gold";
}

/** Common IANA timezones. Fall back to Intl.supportedValuesOf when present. */
export function listTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      return intl.supportedValuesOf("timeZone");
    } catch {
      /* fall through */
    }
  }
  return [
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Africa/Lagos",
    "Africa/Nairobi",
    "America/Chicago",
    "America/Denver",
    "America/Halifax",
    "America/Los_Angeles",
    "America/Mexico_City",
    "America/New_York",
    "America/Phoenix",
    "America/Sao_Paulo",
    "America/Toronto",
    "Asia/Bangkok",
    "Asia/Dubai",
    "Asia/Hong_Kong",
    "Asia/Jakarta",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Riyadh",
    "Asia/Seoul",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Melbourne",
    "Australia/Sydney",
    "Europe/Amsterdam",
    "Europe/Berlin",
    "Europe/Istanbul",
    "Europe/London",
    "Europe/Madrid",
    "Europe/Paris",
    "Europe/Stockholm",
    "Europe/Warsaw",
    "Europe/Zurich",
    "Pacific/Auckland",
    "UTC",
  ];
}

/** Wall-clock parts in a given IANA timezone for a Date. */
function partsInTimezone(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: wdMap[get("weekday")] ?? 0,
    hour: parseInt(get("hour") || "0", 10) % 24,
    minute: parseInt(get("minute") || "0", 10),
    y: parseInt(get("year"), 10),
    m: parseInt(get("month"), 10),
    d: parseInt(get("day"), 10),
  };
}

/**
 * Next time (UTC Date) that matches the given local day/hour in `timezone`,
 * strictly after `from`. Probes the next 14 days hour-by-hour using
 * Intl.DateTimeFormat, handles DST without needing a tz library.
 */
export function nextScheduledRun(
  prefs: WeeklyReviewPrefs,
  from: Date = new Date(),
): Date | null {
  if (!prefs.weekly_review_enabled) return null;
  // Round up to the next exact hour.
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  for (let i = 0; i < 24 * 14; i++) {
    const candidate = new Date(start.getTime() + i * 3600_000);
    const p = partsInTimezone(candidate, prefs.timezone);
    if (p.weekday === prefs.weekly_review_day && p.hour === prefs.weekly_review_hour) {
      return candidate;
    }
  }
  return null;
}
