import { supabase } from "@/integrations/supabase/client";

export type GoalMetricType = "tasks_completed" | "hours" | "custom";
export type GoalStatus = "open" | "met" | "missed";

export type WeeklyGoal = {
  id: string;
  user_id: string;
  business_id: string | null;
  week_start: string;
  week_end: string;
  title: string;
  description: string | null;
  metric_type: GoalMetricType;
  target_value: number | null;
  current_value: number;
  status: GoalStatus;
  carried_from: string | null;
  created_at: string;
  updated_at: string;
};

/** Returns Monday 00:00 of the week containing `date` (local time). */
export function getWeekRange(date = new Date()): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7; // 0 = Mon
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function getPreviousWeekRange(date = new Date()) {
  const { start } = getWeekRange(date);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(start);
  return { start: prevStart, end: prevEnd };
}

export async function listGoalsForWeek(weekStart: Date): Promise<WeeklyGoal[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("weekly_goals")
    .select("*")
    .eq("user_id", u.user.id)
    .eq("week_start", weekStart.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WeeklyGoal[];
}

export async function createGoal(input: {
  business_id: string | null;
  title: string;
  description?: string | null;
  metric_type: GoalMetricType;
  target_value: number | null;
  week_start: Date;
  week_end: Date;
  carried_from?: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("weekly_goals").insert({
    user_id: u.user.id,
    business_id: input.business_id,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    metric_type: input.metric_type,
    target_value: input.target_value,
    week_start: input.week_start.toISOString(),
    week_end: input.week_end.toISOString(),
    carried_from: input.carried_from ?? null,
  });
  if (error) throw error;
}

export async function updateGoal(
  id: string,
  patch: Partial<Pick<WeeklyGoal, "title" | "description" | "target_value" | "current_value" | "status" | "metric_type" | "business_id">>,
) {
  const { error } = await supabase.from("weekly_goals").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteGoal(id: string) {
  const { error } = await supabase.from("weekly_goals").delete().eq("id", id);
  if (error) throw error;
}

/** Compute the current value for measurable goals in the given week. */
export async function computeMeasuredProgress(goal: WeeklyGoal): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;

  if (goal.metric_type === "tasks_completed") {
    let q = supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("status", "done")
      .gte("completed_at", goal.week_start)
      .lt("completed_at", goal.week_end);
    if (goal.business_id) q = q.eq("business_id", goal.business_id);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  if (goal.metric_type === "hours") {
    let q = supabase
      .from("time_entries")
      .select("minutes, started_at, ended_at, business_id")
      .eq("user_id", u.user.id)
      .gte("started_at", goal.week_start)
      .lt("started_at", goal.week_end);
    if (goal.business_id) q = q.eq("business_id", goal.business_id);
    const { data, error } = await q;
    if (error) throw error;
    const now = Date.now();
    const minutes = (data ?? []).reduce((sum, r) => {
      const m = r.ended_at
        ? r.minutes
        : Math.max(0, Math.round((now - +new Date(r.started_at)) / 60000));
      return sum + m;
    }, 0);
    return Math.round((minutes / 60) * 10) / 10;
  }

  return goal.current_value;
}

/**
 * Sync current_value on all measurable goals for the week, and auto-close 'met'.
 * Returns the refreshed goals.
 */
export async function refreshGoalsForWeek(weekStart: Date): Promise<WeeklyGoal[]> {
  const goals = await listGoalsForWeek(weekStart);
  for (const g of goals) {
    if (g.metric_type === "custom") continue;
    const current = await computeMeasuredProgress(g);
    const nextStatus: GoalStatus =
      g.status === "missed"
        ? "missed"
        : g.target_value != null && current >= g.target_value
          ? "met"
          : "open";
    if (current !== g.current_value || nextStatus !== g.status) {
      await updateGoal(g.id, { current_value: current, status: nextStatus });
      g.current_value = current;
      g.status = nextStatus;
    }
  }
  return goals;
}

/**
 * Carry forward any unmet ('open' or 'missed') goals from last week into the
 * current week, but only if no goal for the current week already references
 * them (idempotent). Returns the number of goals carried over.
 */
export async function carryForwardUnmet(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;
  const { start: thisStart, end: thisEnd } = getWeekRange();
  const { start: prevStart, end: prevEnd } = getPreviousWeekRange();

  const { data: prev, error: e1 } = await supabase
    .from("weekly_goals")
    .select("*")
    .eq("user_id", u.user.id)
    .eq("week_start", prevStart.toISOString())
    .in("status", ["open", "missed"]);
  if (e1) throw e1;
  if (!prev || prev.length === 0) return 0;

  const { data: existing, error: e2 } = await supabase
    .from("weekly_goals")
    .select("carried_from")
    .eq("user_id", u.user.id)
    .eq("week_start", thisStart.toISOString())
    .not("carried_from", "is", null);
  if (e2) throw e2;
  const alreadyCarried = new Set((existing ?? []).map((r) => r.carried_from));

  const toCopy = (prev as WeeklyGoal[]).filter((g) => !alreadyCarried.has(g.id));
  if (toCopy.length === 0) return 0;

  const rows = toCopy.map((g) => ({
    user_id: u.user!.id,
    business_id: g.business_id,
    title: g.title,
    description: g.description,
    metric_type: g.metric_type,
    target_value: g.target_value,
    week_start: thisStart.toISOString(),
    week_end: thisEnd.toISOString(),
    carried_from: g.id,
  }));
  const { error: e3 } = await supabase.from("weekly_goals").insert(rows);
  if (e3) throw e3;

  // Mark the previous open ones as missed so they don't keep flagging
  const stillOpen = toCopy.filter((g) => g.status === "open").map((g) => g.id);
  if (stillOpen.length > 0) {
    await supabase.from("weekly_goals").update({ status: "missed" }).in("id", stillOpen);
  }

  return toCopy.length;
}
