import { supabase } from "@/integrations/supabase/client";

export type ListViewMode = "list" | "board" | "calendar";
export type GroupByKey = "stage" | "priority" | "assignee" | "due" | "outcome" | "none";
export type SortKey = "priority" | "due" | "created" | "title";

export type ListViewFilters = {
  priority: string;
  status: string;
  due: string;
  assigned: string;
};

export type ListViewConfig = {
  view: ListViewMode;
  group_by: GroupByKey;
  filters: ListViewFilters;
  sort: { key: SortKey };
  column_order: string[];
  collapsed_groups: string[];
};

export const DEFAULT_VIEW_CONFIG: ListViewConfig = {
  view: "list",
  group_by: "stage",
  filters: { priority: "all", status: "all", due: "all", assigned: "all" },
  sort: { key: "priority" },
  column_order: [],
  collapsed_groups: [],
};

export async function fetchListView(
  listId: string,
  userId: string,
): Promise<ListViewConfig | null> {
  const { data, error } = await supabase
    .from("user_list_views")
    .select("view, group_by, filters, sort, column_order, collapsed_groups")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    view: (data.view as ListViewMode) ?? DEFAULT_VIEW_CONFIG.view,
    group_by: (data.group_by as GroupByKey) ?? DEFAULT_VIEW_CONFIG.group_by,
    filters: { ...DEFAULT_VIEW_CONFIG.filters, ...((data.filters as object) ?? {}) } as ListViewFilters,
    sort: { ...DEFAULT_VIEW_CONFIG.sort, ...((data.sort as object) ?? {}) } as { key: SortKey },
    column_order: (data.column_order as string[]) ?? [],
    collapsed_groups: (data.collapsed_groups as string[]) ?? [],
  };
}

export async function saveListView(
  listId: string,
  userId: string,
  patch: Partial<ListViewConfig>,
) {
  const { error } = await supabase
    .from("user_list_views")
    .upsert(
      {
        list_id: listId,
        user_id: userId,
        ...patch,
      },
      { onConflict: "user_id,list_id" },
    );
  if (error) throw error;
}
