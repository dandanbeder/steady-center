import { supabase } from "@/integrations/supabase/client";

export type InboxStatus = "pending" | "accepted" | "dismissed";
export type InboxType = "task" | "note" | "event";

export type InboxItem = {
  id: string;
  owner_id: string;
  raw_text: string;
  source: string;
  status: InboxStatus;
  suggested_type: InboxType | null;
  suggested_title: string | null;
  suggested_body: string | null;
  suggested_business_id: string | null;
  suggested_folder_id: string | null;
  suggested_list_id: string | null;
  suggested_priority: "low" | "normal" | "high" | "urgent" | null;
  suggested_due_at: string | null;
  ai_processed_at: string | null;
  resulting_ref_type: string | null;
  resulting_ref_id: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

const T = "inbox_items" as never;

export async function listInbox(status: InboxStatus = "pending"): Promise<InboxItem[]> {
  const { data, error } = await (supabase.from(T) as any)
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as InboxItem[];
}

export async function countPendingInbox(): Promise<number> {
  const { count, error } = await (supabase.from(T) as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export async function captureToInbox(input: {
  raw_text: string;
  source?: string;
}): Promise<InboxItem> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await (supabase.from(T) as any)
    .insert({
      owner_id: u.user.id,
      raw_text: input.raw_text,
      source: input.source ?? "quick_add",
    })
    .select()
    .single();
  if (error) throw error;
  return data as InboxItem;
}

export async function updateInboxSuggestion(
  id: string,
  patch: Partial<Pick<InboxItem,
    "suggested_type" | "suggested_title" | "suggested_body" |
    "suggested_business_id" | "suggested_folder_id" | "suggested_list_id" |
    "suggested_priority" | "suggested_due_at"
  >>,
) {
  const { error } = await (supabase.from(T) as any).update(patch).eq("id", id);
  if (error) throw error;
}

export async function dismissInbox(id: string) {
  const { error } = await (supabase.from(T) as any)
    .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markInboxAccepted(id: string, ref: { type: string; id: string }) {
  const { error } = await (supabase.from(T) as any)
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      resulting_ref_type: ref.type,
      resulting_ref_id: ref.id,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteInbox(id: string) {
  const { error } = await (supabase.from(T) as any).delete().eq("id", id);
  if (error) throw error;
}
