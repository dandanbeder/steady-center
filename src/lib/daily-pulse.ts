import { supabase } from "@/integrations/supabase/client";

export type FocusItem = { task_id: string; title: string; due_at: string | null };

export type DailyPulse = {
  id: string;
  owner_id: string;
  pulse_date: string;
  kind: "morning" | "evening";
  summary_text: string | null;
  meetings_json: Array<{ id: string; title: string; start_at: string; end_at: string }>;
  focus_3: FocusItem[];
  overdue_count: number;
  at_risk_count: number;
  capacity_hours: number;
  scheduled_hours: number;
  generated_at: string | null;
  email_sent_at: string | null;
  confirmed_focus_at: string | null;
  created_at: string;
};

const T = "daily_pulses" as never;

function localDateStr(tz?: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function getTodaysPulses(tz?: string): Promise<{ morning?: DailyPulse; evening?: DailyPulse }> {
  const today = localDateStr(tz);
  const { data, error } = await (supabase.from(T) as any)
    .select("*")
    .eq("pulse_date", today)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  const out: { morning?: DailyPulse; evening?: DailyPulse } = {};
  for (const row of (data ?? []) as DailyPulse[]) {
    if (!out[row.kind]) out[row.kind] = row;
  }
  return out;
}

export async function confirmFocus3(pulseId: string, focus: FocusItem[]) {
  const { error } = await (supabase.from(T) as any)
    .update({ focus_3: focus, confirmed_focus_at: new Date().toISOString() })
    .eq("id", pulseId);
  if (error) throw error;
}

export async function rollForwardTask(taskId: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const { error } = await supabase
    .from("tasks")
    .update({ due_at: tomorrow.toISOString() })
    .eq("id", taskId);
  if (error) throw error;
}

export async function completeTask(taskId: string) {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done" })
    .eq("id", taskId);
  if (error) throw error;
}
