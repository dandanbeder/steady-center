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
  parent_folder_id: string | null;
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

export type RecurrenceRule = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

export type Task = {
  id: string;
  owner_id: string;
  /** NULL = Uncategorised (also requires business_id NULL). */
  list_id: string | null;
  business_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  position: number;
  created_at: string;
  recurrence_rule: RecurrenceRule | null;
  recurrence_anchor: string | null;
  /** Monday (YYYY-MM-DD, UTC) of the week the task is committed to. NULL = backlog. */
  committed_week: string | null;
  /** Outcome (epic) this task rolls up to. */
  outcome_id: string | null;
  /** Member of the task's account this task is assigned to (nullable). */
  assignee_id: string | null;
  /** Who made the most recent assignment change. */
  assigned_by: string | null;
  assigned_at: string | null;
  /** Workflow stage this task is in (null only during migration / brand-new lists). */
  stage_id: string | null;
  /** Position within its stage column. */
  stage_position: number;
  /** The note this task was created from (null if not note-sourced). FK ON DELETE SET NULL. */
  source_note_id: string | null;
};

export type TaskAssignment = {
  id: string;
  task_id: string;
  business_id: string | null;
  from_assignee: string | null;
  to_assignee: string | null;
  changed_by: string | null;
  changed_at: string;
};

export async function listAssignmentHistory(taskId: string): Promise<TaskAssignment[]> {
  const { data, error } = await supabase
    .from("task_assignment_history")
    .select("id, task_id, business_id, from_assignee, to_assignee, changed_by, changed_at")
    .eq("task_id", taskId)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as TaskAssignment[];
}

export async function listAssignedToMe(): Promise<Task[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "done")
    .eq("assignee_id", u.user.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function listAssignedByMe(): Promise<Task[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .eq("assigned_by", u.user.id)
    .not("assignee_id", "is", null)
    .neq("assignee_id", u.user.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function assignTask(input: {
  task_id: string;
  assignee_id: string | null;
  priority?: TaskPriority;
  due_at?: string | null;
}) {
  const patch: Partial<Task> = { assignee_id: input.assignee_id };
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.due_at !== undefined) patch.due_at = input.due_at;
  const { error } = await supabase.from("tasks").update(patch).eq("id", input.task_id);
  if (error) throw error;
}

export const RECURRENCE_LABEL: Record<RecurrenceRule, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

export function nextOccurrence(date: Date, rule: RecurrenceRule): Date {
  const d = new Date(date);
  switch (rule) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

// ---- folders
export async function listFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function createFolder(input: {
  business_id: string;
  name: string;
  color?: string;
  parent_folder_id?: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("folders").insert({
    business_id: input.business_id,
    name: input.name,
    color: input.color ?? "#7A8471",
    owner_id: u.user.id,
    parent_folder_id: input.parent_folder_id ?? null,
  });
  if (error) throw error;
}
export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, "name" | "color" | "parent_folder_id">>,
) {
  const { error } = await supabase.from("folders").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteFolder(id: string) {
  const { error } = await supabase
    .from("folders")
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}
export async function restoreFolder(id: string) {
  const { error } = await supabase
    .from("folders")
    .update({ deleted_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}

// ---- lists
export async function listLists(): Promise<ListRow[]> {
  const { data, error } = await supabase
    .from("lists")
    .select("*")
    .is("deleted_at", null)
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
  const { error } = await supabase
    .from("lists")
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}
export async function restoreList(id: string) {
  const { error } = await supabase
    .from("lists")
    .update({ deleted_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}

// ---- tasks
export async function listTasksByList(listId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("list_id", listId)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

/** Tasks with no list (and therefore no account) owned by the caller. */
export async function listUncategorisedTasks(): Promise<Task[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("list_id", null)
    .is("deleted_at", null)
    .eq("owner_id", u.user.id)
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
    .is("deleted_at", null)
    .neq("status", "done")
    .not("due_at", "is", null)
    .lte("due_at", end.toISOString())
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

/** Tasks with due_at in [start, end). Includes done tasks so the planner can show completed work. */
export async function listTasksInRange(start: Date, end: Date): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .not("due_at", "is", null)
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function createTask(input: {
  /** Null = create an Uncategorised personal task; business_id must also be null. */
  list_id: string | null;
  business_id: string | null;
  title: string;
  parent_task_id?: string | null;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
  recurrence_rule?: RecurrenceRule | null;
  outcome_id?: string | null;
  stage_id?: string | null;
  assignee_id?: string | null;
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
    recurrence_rule: input.recurrence_rule ?? null,
    recurrence_anchor: input.recurrence_rule && input.due_at ? input.due_at : null,
    outcome_id: input.outcome_id ?? null,
    stage_id: input.stage_id ?? null,
    assignee_id: input.assignee_id ?? null,
  });
  if (error) throw error;
}


export async function updateTask(id: string, patch: Partial<Omit<Task, "id" | "owner_id" | "created_at">>) {
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string) {
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}
export async function restoreTask(id: string) {
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function bulkUpdateTasks(ids: string[], patch: Partial<Pick<Task, "status" | "priority" | "due_at">>) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("tasks").update(patch).in("id", ids);
  if (error) throw error;
}

export async function bulkDeleteTasks(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() } as never)
    .in("id", ids);
  if (error) throw error;
}
export async function bulkRestoreTasks(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null } as never)
    .in("id", ids);
  if (error) throw error;
}

export type TaskActivity = {
  id: string;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  changed_at: string;
  changed_by: string | null;
};

export async function listTaskActivity(taskId: string): Promise<TaskActivity[]> {
  const { data, error } = await supabase
    .from("task_status_history")
    .select("id, task_id, from_status, to_status, changed_at, changed_by")
    .eq("task_id", taskId)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as TaskActivity[];
}

/** When a recurring task is marked done, spawn the next occurrence and revert this one. */
export async function rolloverRecurring(task: Task): Promise<void> {
  if (!task.recurrence_rule) return;
  const anchor = task.due_at ? new Date(task.due_at) : new Date();
  const next = nextOccurrence(anchor, task.recurrence_rule);
  await createTask({
    list_id: task.list_id,
    business_id: task.business_id,
    title: task.title,
    description: task.description ?? null,
    priority: task.priority,
    due_at: next.toISOString(),
    position: task.position + 1,
    recurrence_rule: task.recurrence_rule,
  });
}

