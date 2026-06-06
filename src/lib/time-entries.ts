import { supabase } from "@/integrations/supabase/client";

export type TimeEntry = {
  id: string;
  task_id: string;
  business_id: string | null;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  source: "timer" | "manual";
  note: string | null;
  created_at: string;
};

function diffMinutes(a: string, b: string) {
  return Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 60000));
}

export async function getRunningTimer(): Promise<TimeEntry | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("user_id", u.user.id)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TimeEntry | null;
}

export async function startTimer(task: { id: string; business_id: string | null }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  // Stop any currently running timer first
  const running = await getRunningTimer();
  if (running) await stopTimer(running);
  const { error } = await supabase.from("time_entries").insert({
    task_id: task.id,
    business_id: task.business_id,
    user_id: u.user.id,
    started_at: new Date().toISOString(),
    source: "timer",
  });
  if (error) throw error;
}

export async function stopTimer(entry: TimeEntry) {
  const ended = new Date().toISOString();
  const { error } = await supabase
    .from("time_entries")
    .update({ ended_at: ended, minutes: diffMinutes(entry.started_at, ended) })
    .eq("id", entry.id);
  if (error) throw error;
}

export async function logManualMinutes(input: {
  task_id: string;
  business_id: string | null;
  minutes: number;
  note?: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  if (input.minutes <= 0) throw new Error("Minutes must be positive");
  const now = new Date();
  const started = new Date(now.getTime() - input.minutes * 60000);
  const { error } = await supabase.from("time_entries").insert({
    task_id: input.task_id,
    business_id: input.business_id,
    user_id: u.user.id,
    started_at: started.toISOString(),
    ended_at: now.toISOString(),
    minutes: input.minutes,
    source: "manual",
    note: input.note ?? null,
  });
  if (error) throw error;
}

export async function listEntriesForTask(taskId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

/** Returns total minutes per task across all entries the caller can see. */
export async function listTaskMinutes(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("task_id, minutes, started_at, ended_at");
  if (error) throw error;
  const totals: Record<string, number> = {};
  const now = Date.now();
  for (const r of (data ?? []) as Array<Pick<TimeEntry, "task_id" | "minutes" | "started_at" | "ended_at">>) {
    const m = r.ended_at
      ? r.minutes
      : Math.max(0, Math.round((now - +new Date(r.started_at)) / 60000));
    totals[r.task_id] = (totals[r.task_id] ?? 0) + m;
  }
  return totals;
}

/** Minutes per task for entries since the start of the current local week (Mon 00:00). */
export async function listTaskMinutesThisWeek(): Promise<Record<string, number>> {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

  const { data, error } = await supabase
    .from("time_entries")
    .select("task_id, minutes, started_at, ended_at")
    .gte("started_at", weekStart.toISOString());
  if (error) throw error;
  const totals: Record<string, number> = {};
  const nowMs = Date.now();
  for (const r of (data ?? []) as Array<Pick<TimeEntry, "task_id" | "minutes" | "started_at" | "ended_at">>) {
    const m = r.ended_at
      ? r.minutes
      : Math.max(0, Math.round((nowMs - +new Date(r.started_at)) / 60000));
    totals[r.task_id] = (totals[r.task_id] ?? 0) + m;
  }
  return totals;
}

export function formatMinutes(min: number): string {
  if (!min || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
