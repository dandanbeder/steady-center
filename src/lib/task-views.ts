import { supabase } from "@/integrations/supabase/client";
import type {
  GroupByKey,
  ListViewFilters,
  SortKey,
} from "@/lib/user-list-views";

export type ViewKind = "list" | "board" | "calendar" | "timeline";

export type TaskView = {
  id: string;
  list_id: string;
  owner_id: string;
  name: string;
  view: ViewKind;
  group_by: GroupByKey;
  filters: ListViewFilters;
  sort: { key: SortKey };
  column_order: string[];
  collapsed_groups: string[];
  is_default: boolean;
  is_shared: boolean;
  pinned: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type TaskViewInput = {
  list_id: string;
  name: string;
  view: ViewKind;
  group_by: GroupByKey;
  filters: ListViewFilters;
  sort: { key: SortKey };
  column_order?: string[];
  collapsed_groups?: string[];
  is_shared?: boolean;
  pinned?: boolean;
  is_default?: boolean;
  position?: number;
};

function row(r: Record<string, unknown>): TaskView {
  return {
    id: String(r.id),
    list_id: String(r.list_id),
    owner_id: String(r.owner_id),
    name: String(r.name),
    view: r.view as ViewKind,
    group_by: r.group_by as GroupByKey,
    filters: (r.filters ?? {}) as ListViewFilters,
    sort: (r.sort ?? { key: "priority" }) as { key: SortKey },
    column_order: (r.column_order as string[]) ?? [],
    collapsed_groups: (r.collapsed_groups as string[]) ?? [],
    is_default: !!r.is_default,
    is_shared: !!r.is_shared,
    pinned: r.pinned !== false,
    position: typeof r.position === "number" ? r.position : 0,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listTaskViews(listId: string): Promise<TaskView[]> {
  const { data, error } = await supabase
    .from("task_views")
    .select("*")
    .eq("list_id", listId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row);
}

export async function createTaskView(input: TaskViewInput): Promise<TaskView> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  // If marked default, clear other defaults first (partial unique index allows only one).
  if (input.is_default) await clearDefault(input.list_id, u.user.id);
  const { data, error } = await supabase
    .from("task_views")
    .insert({
      list_id: input.list_id,
      owner_id: u.user.id,
      name: input.name,
      view: input.view,
      group_by: input.group_by,
      filters: input.filters as unknown as Record<string, unknown>,
      sort: input.sort as unknown as Record<string, unknown>,
      column_order: input.column_order ?? [],
      collapsed_groups: input.collapsed_groups ?? [],
      is_shared: input.is_shared ?? false,
      pinned: input.pinned ?? true,
      is_default: input.is_default ?? false,
      position: input.position ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return row(data);
}

export async function updateTaskView(
  id: string,
  patch: Partial<Omit<TaskView, "id" | "list_id" | "owner_id" | "created_at" | "updated_at">>,
): Promise<void> {
  if (patch.is_default) {
    const { data: v } = await supabase
      .from("task_views")
      .select("list_id, owner_id")
      .eq("id", id)
      .maybeSingle();
    if (v) await clearDefault(v.list_id as string, v.owner_id as string, id);
  }
  const { error } = await supabase
    .from("task_views")
    .update(patch as unknown as Record<string, unknown>)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTaskView(id: string): Promise<void> {
  const { error } = await supabase.from("task_views").delete().eq("id", id);
  if (error) throw error;
}

export async function reorderTaskViews(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await Promise.all(
    ids.map((id, i) =>
      supabase.from("task_views").update({ position: i }).eq("id", id),
    ),
  );
}

async function clearDefault(listId: string, ownerId: string, exceptId?: string) {
  let q = supabase
    .from("task_views")
    .update({ is_default: false })
    .eq("list_id", listId)
    .eq("owner_id", ownerId)
    .eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}
