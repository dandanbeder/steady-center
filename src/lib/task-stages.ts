import { supabase } from "@/integrations/supabase/client";

export type StageKind = "todo" | "in_progress" | "review" | "done" | "custom";

export type TaskStage = {
  id: string;
  list_id: string;
  name: string;
  color: string;
  position: number;
  kind: StageKind;
  is_terminal: boolean;
};

export async function fetchStages(listId: string): Promise<TaskStage[]> {
  const { data, error } = await supabase
    .from("task_stages")
    .select("id, list_id, name, color, position, kind, is_terminal")
    .eq("list_id", listId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TaskStage[];
}

export async function createStage(input: {
  list_id: string;
  name: string;
  color?: string;
  position?: number;
}) {
  const { data, error } = await supabase
    .from("task_stages")
    .insert({
      list_id: input.list_id,
      name: input.name,
      color: input.color ?? "#7A8471",
      position: input.position ?? 0,
      kind: "custom",
    })
    .select()
    .single();
  if (error) throw error;
  return data as TaskStage;
}

export async function updateStage(
  id: string,
  patch: Partial<Pick<TaskStage, "name" | "color" | "position" | "is_terminal">>,
) {
  const { error } = await supabase.from("task_stages").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteStage(id: string, reassignTo: string) {
  // Move tasks first, then delete stage
  const { error: mvErr } = await supabase
    .from("tasks")
    .update({ stage_id: reassignTo })
    .eq("stage_id", id);
  if (mvErr) throw mvErr;
  const { error } = await supabase.from("task_stages").delete().eq("id", id);
  if (error) throw error;
}

export async function reorderStages(ids: string[]) {
  // Bulk update positions
  await Promise.all(
    ids.map((id, i) =>
      supabase.from("task_stages").update({ position: i }).eq("id", id),
    ),
  );
}

export async function moveTaskToStage(
  taskId: string,
  stageId: string,
  stagePosition: number,
) {
  const { error } = await supabase
    .from("tasks")
    .update({ stage_id: stageId, stage_position: stagePosition })
    .eq("id", taskId);
  if (error) throw error;
}

export async function reorderTasksInStage(taskIds: string[]) {
  await Promise.all(
    taskIds.map((id, i) =>
      supabase.from("tasks").update({ stage_position: i }).eq("id", id),
    ),
  );
}
