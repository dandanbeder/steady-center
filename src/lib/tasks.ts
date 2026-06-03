import { supabase } from "@/integrations/supabase/client";

export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "urgent" | "high" | "normal" | "low";

export const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "#dc2626", // red
  high: "#ea580c",   // orange
  normal: "#2563eb", // blue
  low: "#9ca3af",    // grey
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

export type Folder = {
  id: string;
  owner_id: string;
  business_id: string;
  name: string;
  color: string;
  created_at: string;
};

export type ListRow = {
  id: string;
  owner_id: string;
  folder_id: string;
  name: string;
  created_at: string;
};

export type Task = {
  id: string;
  owner_id: string;
  list_id: string;
  business_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  position: number;
  created_at: string;
};

// ---- folders
export async function listFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function createFolder(input: { business_id: string; name: string; color?: string }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("folders").insert({
    business_id: input.business_id,
    name: input.name,
    color: input.color ?? "#7A8471",
    owner_id: u.user.id,
  });
  if (error) throw error;
}
export async function updateFolder(id: string, patch: Partial<Pick<Folder, "name" | "color">>) {
  const { error } = await supabase.from("folders").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteFolder(id: string) {
  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) throw error;
}

// ---- lists
export async function listLists(): Promise<ListRow[]> {
  const { data, error } = await supabase
    .from("lists")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function createList(input: { folder_id: string; name: string }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("lists")
    .insert({ folder_id: input.folder_id, name: input.name, owner_id: u.user.id });
  if (error) throw error;
}
export async function updateList(id: string, patch: Partial<Pick<ListRow, "name">>) {
  const { error } = await supabase.from("lists").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteList(id: string) {
  const { error } = await supabase.from("lists").delete().eq("id", id);
  if (error) throw error;
}

// ---- tasks
export async function listTasksByList(listId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("list_id", listId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function listMyWeekTasks(): Promise<Task[]> {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  // overdue (any past due) + next 7 days
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .neq("status", "done")
    .not("due_at", "is", null)
    .lte("due_at", end.toISOString())
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function createTask(input: {
  list_id: string;
  business_id: string | null;
  title: string;
  parent_task_id?: string | null;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("tasks").insert({
    list_id: input.list_id,
    business_id: input.business_id,
    title: input.title,
    parent_task_id: input.parent_task_id ?? null,
    description: input.description ?? null,
    status: input.status ?? "todo",
    priority: input.priority ?? "normal",
    due_at: input.due_at ?? null,
    position: input.position ?? 0,
    owner_id: u.user.id,
  });
  if (error) throw error;
}

export async function updateTask(id: string, patch: Partial<Omit<Task, "id" | "owner_id" | "created_at">>) {
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
