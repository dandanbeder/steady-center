import { supabase } from "@/integrations/supabase/client";

export type Reminder = {
  id: string;
  owner_id: string;
  ref_type: "event" | "task";
  ref_id: string;
  remind_at: string;
  channel: "email" | "sms";
  sent: boolean;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

export async function listRemindersFor(refType: "event" | "task", refId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("ref_type", refType)
    .eq("ref_id", refId)
    .order("remind_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export async function addReminder(input: {
  ref_type: "event" | "task";
  ref_id: string;
  anchor_at: string; // ISO of event.start_at or task.due_at
  lead_minutes: number;
  channel: "email" | "sms";
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const remindAt = new Date(new Date(input.anchor_at).getTime() - input.lead_minutes * 60_000).toISOString();
  const { error } = await supabase.from("reminders").insert({
    owner_id: u.user.id,
    ref_type: input.ref_type,
    ref_id: input.ref_id,
    remind_at: remindAt,
    channel: input.channel,
  });
  if (error) throw error;
}

export async function deleteReminder(id: string) {
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) throw error;
}

export const LEAD_TIME_OPTIONS: Array<{ label: string; minutes: number }> = [
  { label: "At time", minutes: 0 },
  { label: "5 min before", minutes: 5 },
  { label: "15 min before", minutes: 15 },
  { label: "30 min before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 60 * 24 },
  { label: "2 days before", minutes: 60 * 24 * 2 },
];
