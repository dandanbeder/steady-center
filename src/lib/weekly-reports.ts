import { supabase } from "@/integrations/supabase/client";
import type {
  ReportMetrics,
  ReportNarrative,
  PerBusinessMetrics,
  OverdueEntry,
  AtRiskEntry,
  VsLastWeek,
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

export async function updateWeeklyReviewPrefs(p: {
  weekly_review_day: number;
  weekly_review_hour: number;
  weekly_review_enabled: boolean;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update(p).eq("id", u.user.id);
  if (error) throw error;
}

export async function getWeeklyReviewPrefs() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("weekly_review_day, weekly_review_hour, weekly_review_enabled")
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return (
    data ?? {
      weekly_review_day: 5,
      weekly_review_hour: 16,
      weekly_review_enabled: true,
    }
  );
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** green if completion >= 0.7, gold otherwise. */
export function reportStatus(r: WeeklyReport): "green" | "gold" {
  const rate = r.metrics?.overall?.completion_rate ?? 0;
  return rate >= 0.7 ? "green" : "gold";
}
