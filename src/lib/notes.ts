import { supabase } from "@/integrations/supabase/client";

export type Note = {
  id: string;
  owner_id: string;
  business_id: string | null;
  folder_id: string | null;
  title: string;
  body: string;
  source: string;
  created_at: string;
};

export async function listNotes(): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Note[];
}

export async function createNote(input: {
  business_id: string | null;
  folder_id: string | null;
  title: string;
  body: string;
  source?: string;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("notes")
    .insert({
      business_id: input.business_id,
      folder_id: input.folder_id,
      title: input.title,
      body: input.body,
      source: input.source ?? "manual",
      owner_id: u.user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Note;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "body" | "business_id" | "folder_id">>,
) {
  const { error } = await supabase.from("notes").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteNote(id: string) {
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw error;
}
