import { supabase } from "@/integrations/supabase/client";

export type TaskAttachment = {
  id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
};

export const TASK_ATTACHMENT_BUCKET = "task-attachments";
export const TASK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Conservative allow-list. PDF, common Office, plain text, common images.
const ALLOWED_PREFIXES = ["image/", "text/"];
const ALLOWED_EXACT = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/json",
  "application/zip",
]);

export function isAllowedMime(mime: string | null | undefined) {
  if (!mime) return true; // browser sometimes omits, server RLS still gates access
  if (ALLOWED_EXACT.has(mime)) return true;
  return ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
}

export async function listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TaskAttachment[];
}

export async function uploadTaskAttachment(args: {
  taskId: string;
  file: File;
}): Promise<TaskAttachment> {
  const { taskId, file } = args;
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `File is larger than ${Math.round(TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }
  if (!isAllowedMime(file.type)) {
    throw new Error("That file type isn't supported.");
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");

  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${taskId}/${crypto.randomUUID()}-${safe}`;

  const { error: upErr } = await supabase.storage
    .from(TASK_ATTACHMENT_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("task_attachments")
    .insert({
      task_id: taskId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      created_by: u.user.id,
    })
    .select()
    .single();
  if (error) {
    // Roll back the upload so we don't leave orphan blobs.
    await supabase.storage.from(TASK_ATTACHMENT_BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data as TaskAttachment;
}

export async function deleteTaskAttachment(att: TaskAttachment): Promise<void> {
  await supabase.storage.from(TASK_ATTACHMENT_BUCKET).remove([att.storage_path]).catch(() => {});
  const { error } = await supabase.from("task_attachments").delete().eq("id", att.id);
  if (error) throw error;
}

/**
 * Returns a short-lived signed URL for download/preview. The signed-URL call
 * itself is guarded by the storage SELECT policy, which re-evaluates
 * `can_access(user, 'task', task_id, 'viewer')` server-side. A user without
 * task access cannot mint a URL, regardless of UI state.
 */
export async function getTaskAttachmentUrl(
  path: string,
  expiresInSeconds = 60 * 5,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(TASK_ATTACHMENT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
