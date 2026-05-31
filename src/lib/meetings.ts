import { supabase } from "@/integrations/supabase/client";

export type Meeting = {
  id: string;
  owner_id: string;
  business_id: string | null;
  event_id: string | null;
  platform: string;
  title: string;
  transcript: string;
  summary: string;
  decisions: string[];
  audio_path: string | null;
  created_at: string;
};

export type ActionItem = {
  id: string;
  owner_id: string;
  business_id: string | null;
  source_type: string;
  source_id: string | null;
  text: string;
  owner_label: string | null;
  due_at: string | null;
  task_id: string | null;
  done: boolean;
  created_at: string;
};

export async function listMeetings(businessId?: string | null): Promise<Meeting[]> {
  let q = supabase.from("meetings" as any).select("*").order("created_at", { ascending: false });
  if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Meeting[];
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase.from("meetings" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as Meeting | null;
}

export async function deleteMeeting(id: string) {
  const { error } = await supabase.from("meetings" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listActionItems(meetingId: string): Promise<ActionItem[]> {
  const { data, error } = await supabase
    .from("action_items" as any)
    .select("*")
    .eq("source_type", "meeting")
    .eq("source_id", meetingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ActionItem[];
}

export async function setActionItemDone(id: string, done: boolean) {
  const { error } = await supabase.from("action_items" as any).update({ done }).eq("id", id);
  if (error) throw error;
}

export async function linkActionItemTask(id: string, taskId: string) {
  const { error } = await supabase.from("action_items" as any).update({ task_id: taskId }).eq("id", id);
  if (error) throw error;
}

export async function uploadMeetingAudio(file: File): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const ext = file.name.split(".").pop() || "bin";
  const path = `${u.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("meeting-audio").upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}
