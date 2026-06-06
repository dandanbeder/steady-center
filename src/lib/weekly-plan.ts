import { supabase } from "@/integrations/supabase/client";
import type { Task } from "@/lib/tasks";

/** Format a Date's local Y-M-D as YYYY-MM-DD (no timezone shift). */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday for the week containing `date` in the user's local timezone, as YYYY-MM-DD.
 *  Local (not UTC) so that early-Monday hours in non-UTC zones aren't mis-bucketed
 *  into the previous week. committed_week is treated as a local calendar date. */
export function mondayOf(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymdLocal(d);
}

/** Add N weeks to a YYYY-MM-DD Monday (local). */
export function addWeeks(monday: string, n: number): string {
  const d = new Date(monday + "T00:00:00"); // local midnight
  d.setDate(d.getDate() + n * 7);
  return ymdLocal(d);
}

/** Date for the start of the Monday week (local midnight). */
function mondayDate(monday: string): Date {
  return new Date(monday + "T00:00:00");
}

/**
 * Backlog = open tasks (not done, not deleted) that are uncommitted OR
 * committed to a past week (rolled over). Optionally scoped to a business.
 */
export async function listBacklog(businessId?: string | null): Promise<Task[]> {
  const thisMonday = mondayOf();
  let q = supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "done")
    .or(`committed_week.is.null,committed_week.lt.${thisMonday}`)
    .order("priority", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false });
  if (businessId !== undefined && businessId !== null) {
    q = q.eq("business_id", businessId);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Task[];
}

/** Tasks committed to the given Monday week (any status). */
export async function listCommitted(weekStart: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .eq("committed_week", weekStart)
    .order("priority", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

/** Tasks committed to a PRIOR week and still open (roll-over candidates). */
export async function listRolledOver(currentMonday: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "done")
    .not("committed_week", "is", null)
    .lt("committed_week", currentMonday)
    .order("committed_week", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function commitTasks(ids: string[], weekStart: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("tasks")
    .update({ committed_week: weekStart })
    .in("id", ids);
  if (error) throw error;
}

export async function uncommitTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("tasks")
    .update({ committed_week: null })
    .in("id", ids);
  if (error) throw error;
}

export type Velocity = {
  tasks_per_week: number; // mean, integer-rounded
  hours_per_week: number; // mean, one decimal
  sample_weeks: number; // 1..4
};

/** Trailing 4-week averages for the signed-in user. */
export async function getVelocity(): Promise<Velocity> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { tasks_per_week: 0, hours_per_week: 0, sample_weeks: 0 };

  const fourWeeksAgo = mondayDate(addWeeks(mondayOf(), -4));
  const thisMondayDate = mondayDate(mondayOf());

  const [{ data: doneTasks }, { data: entries }] = await Promise.all([
    supabase
      .from("tasks")
      .select("completed_at")
      .eq("owner_id", u.user.id)
      .is("deleted_at", null)
      .eq("status", "done")
      .gte("completed_at", fourWeeksAgo.toISOString())
      .lt("completed_at", thisMondayDate.toISOString()),
    supabase
      .from("time_entries")
      .select("minutes, started_at")
      .eq("user_id", u.user.id)
      .gte("started_at", fourWeeksAgo.toISOString())
      .lt("started_at", thisMondayDate.toISOString()),
  ]);

  const taskCount = (doneTasks ?? []).length;
  const totalMinutes = (entries ?? []).reduce(
    (s, r) => s + ((r as { minutes: number | null }).minutes ?? 0),
    0,
  );

  // Always divide by 4 so the average reflects "a typical week" (a quiet week counts).
  const tasksAvg = Math.round(taskCount / 4);
  const hoursAvg = Math.round((totalMinutes / 60 / 4) * 10) / 10;

  return { tasks_per_week: tasksAvg, hours_per_week: hoursAvg, sample_weeks: 4 };
}

/** Approximate hours of an event (0 for all-day). */
export function eventHours(e: { start_at: string; end_at: string; all_day: boolean }): number {
  if (e.all_day) return 0;
  const ms = +new Date(e.end_at) - +new Date(e.start_at);
  return Math.max(0, ms / 3_600_000);
}

/** Default hours assumed for a committed task with no time-block. */
export const DEFAULT_TASK_HOURS = 1;
