import { supabase } from "@/integrations/supabase/client";
import type { NoteType } from "./note-templates";

export type Note = {
  id: string;
  owner_id: string;
  business_id: string | null;
  folder_id: string | null;
  title: string;
  body: string;
  source: string;
  note_type: NoteType;
  pinned: boolean;
  linked_meeting_id: string | null;
  linked_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteAttachment = {
  id: string;
  note_id: string;
  business_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  extracted_text: string | null;
  created_by: string | null;
  created_at: string;
};

const ATTACHMENT_BUCKET = "note-attachments";

export async function listNotes(): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Note[];
}

export async function createNote(input: {
  business_id: string | null;
  folder_id: string | null;
  title: string;
  body: string;
  source?: string;
  note_type?: NoteType;
  linked_meeting_id?: string | null;
  linked_event_id?: string | null;
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
      note_type: input.note_type ?? "note",
      linked_meeting_id: input.linked_meeting_id ?? null,
      linked_event_id: input.linked_event_id ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Note;
}

export async function updateNote(
  id: string,
  patch: Partial<
    Pick<
      Note,
      | "title"
      | "body"
      | "business_id"
      | "folder_id"
      | "note_type"
      | "pinned"
      | "linked_meeting_id"
      | "linked_event_id"
    >
  >,
) {
  const { error } = await supabase.from("notes").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function deleteNote(id: string) {
  const { error } = await supabase
    .from("notes")
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}
export async function restoreNote(id: string) {
  const { error } = await supabase
    .from("notes")
    .update({ deleted_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function moveNote(
  id: string,
  target: { business_id: string | null; folder_id: string | null },
) {
  const { error } = await supabase
    .from("notes")
    .update({ business_id: target.business_id, folder_id: target.folder_id } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function pinNote(id: string, pinned: boolean) {
  await updateNote(id, { pinned });
}

// ---------- Attachments ----------

export async function listAttachments(noteId: string): Promise<NoteAttachment[]> {
  const { data, error } = await supabase
    .from("note_attachments")
    .select("*")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NoteAttachment[];
}

export async function uploadAttachment(args: {
  note: Note;
  file: File;
}): Promise<NoteAttachment> {
  const { note, file } = args;
  if (!note.business_id) throw new Error("Note must belong to an account before attaching files.");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${note.business_id}/${note.id}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("note_attachments")
    .insert({
      note_id: note.id,
      business_id: note.business_id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      created_by: u.user.id,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data as NoteAttachment;
}

export async function deleteAttachment(att: NoteAttachment) {
  await supabase.storage.from(ATTACHMENT_BUCKET).remove([att.storage_path]).catch(() => {});
  const { error } = await supabase.from("note_attachments").delete().eq("id", att.id);
  if (error) throw error;
}

export async function getAttachmentUrl(path: string, expiresInSeconds = 60 * 10) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
