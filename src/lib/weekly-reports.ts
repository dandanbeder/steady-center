import { supabase } from "@/integrations/supabase/client";

export type WeeklyReport = {
  id: string;
  owner_id: string;
  business_id: string | null;
  week_start: string;
  week_end: string;
  metrics: ReportMetrics;
  narrative: string;
  created_at: string;
};

export type PerBusinessMetrics = {
  business_id: string | null;
  business_name: string;
  tasks_created: number;
  tasks_completed: number;
  completed_on_time: number;
  completed_late: number;
  high_priority_open_or_overdue: Array<{ id: string; title: string; due_at: string | null }>;
  meetings_held: number;
  action_items_closed: number;
  action_items_open: number;
  notes_added: number;
};

export type ReportMetrics = {
  overall: PerBusinessMetrics;
  per_business: PerBusinessMetrics[];
};

export async function listWeeklyReports(): Promise<WeeklyReport[]> {
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .order("week_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WeeklyReport[];
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
