import { supabase } from "@/integrations/supabase/client";
import {
  restoreFolder,
  restoreList,
  restoreTask,
} from "@/lib/tasks";
import { restoreNote } from "@/lib/notes";
import { restoreEvent } from "@/lib/calendars";

export type TrashKind = "task" | "note" | "event" | "list" | "folder";

export type TrashRow = {
  kind: TrashKind;
  id: string;
  title: string | null;
  business_id: string | null;
  deleted_at: string;
  parent_id: string | null;
  meta: Record<string, unknown>;
};

export async function listTrash(): Promise<TrashRow[]> {
  const { data, error } = await supabase.rpc("list_trash");
  if (error) throw error;
  return (data ?? []) as TrashRow[];
}

export async function restoreItem(
  kind: TrashKind,
  id: string,
): Promise<{ syncWarning: string | null }> {
  switch (kind) {
    case "task":
      await restoreTask(id);
      return { syncWarning: null };
    case "note":
      await restoreNote(id);
      return { syncWarning: null };
    case "event":
      return await restoreEvent(id);
    case "list":
      await restoreList(id);
      return { syncWarning: null };
    case "folder":
      await restoreFolder(id);
      return { syncWarning: null };
  }
}

export async function hardDeleteItem(kind: TrashKind, id: string) {
  const table =
    kind === "task" ? "tasks" :
    kind === "note" ? "notes" :
    kind === "event" ? "events" :
    kind === "list" ? "lists" :
    "folders";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function emptyTrash(): Promise<string[]> {
  const { data, error } = await supabase.rpc("empty_my_trash");
  if (error) throw error;
  const row = (data ?? [])[0] as { storage_paths?: string[] } | undefined;
  const paths = row?.storage_paths ?? [];
  if (paths.length > 0) {
    await supabase.storage.from("note-attachments").remove(paths).catch(() => {});
  }
  return paths;
}

export function daysUntilPurge(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime();
  const purgeAt = deleted + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}
