import { supabase } from "@/integrations/supabase/client";

export type AnnouncementKind = "info" | "update" | "maintenance" | "feature";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  level: string;
  published_at: string | null;
  expires_at: string | null;
  source: string;
  source_flag_id: string | null;
  created_at: string;
};

/** Active, in-window announcements the user can see (RLS filters audience). */
export async function listActiveAnnouncementsForMe(): Promise<Announcement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,body,kind,level,published_at,expires_at,source,source_flag_id,created_at")
    .eq("active", true)
    .lte("published_at", nowIso)
    .gt("expires_at", nowIso)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Announcement[];
}

export async function listMyDismissals(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("announcement_dismissals")
    .select("announcement_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.announcement_id as string));
}

export async function dismissAnnouncement(announcementId: string) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase
    .from("announcement_dismissals")
    .insert({ user_id: uid, announcement_id: announcementId });
  if (error && !/(duplicate|unique)/i.test(error.message)) throw error;
}
