import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Flag,
  Calendar as CalIcon,
  LayoutList,
  Columns,
  CalendarDays,
  Filter,
  ArrowUpDown,
  Repeat,
  X,
  CheckSquare,
  Link2,
  Focus,
  UserCircle2,
  Settings2,
  Layers,
} from "lucide-react";
import { StageManagerDialog } from "@/components/tasks/stage-manager";
import { groupTasks, type TaskGroup } from "@/components/tasks/group-tasks";
import {
  fetchListView,
  saveListView,
  DEFAULT_VIEW_CONFIG,
  type GroupByKey,
  type ListViewConfig,
} from "@/lib/user-list-views";
import {
  DndContext,
  PointerSensor,
  
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  fetchStages,
  reorderStages,
  moveTaskToStage,
  reorderTasksInStage,
  type TaskStage,
} from "@/lib/task-stages";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagPeople } from "@/components/tag-people";
import { ActivityAndComments } from "@/components/comments/activity-and-comments";

import { ReminderControls } from "@/components/reminder-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  bulkDeleteTasks,
  bulkUpdateTasks,
  createFolder,
  createList,
  createTask,
  deleteFolder,
  deleteList,
  deleteTask,
  listFolders,
  listLists,
  listTaskActivity,
  listTasksByList,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  RECURRENCE_LABEL,
  rolloverRecurring,
  STATUSES,
  STATUS_LABEL,
  updateFolder,
  updateList,
  updateTask,
  type Folder,
  type ListRow,
  type RecurrenceRule,
  type Task,
  type TaskPriority,
  type TaskStatus,
  restoreFolder,
  restoreList,
  restoreTask,
  bulkRestoreTasks,
} from "@/lib/tasks";
import { listAssignedToMe, listAssignedByMe, listAssignmentHistory, assignTask } from "@/lib/tasks";
import { AssigneePicker, useAssignableMembers, memberLabel, type AssignableMember } from "@/components/assignee-picker";
import { useAuth } from "@/hooks/use-auth";
import { listBacklinks, resolveLinks } from "@/lib/note-links";
import { showUndoToast } from "@/lib/undo-toast";
import { listOutcomes, updateOutcome } from "@/lib/outcomes";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { TaskTimerInline, TaskTimePanel } from "@/components/task-timer";
import { FocusMode } from "@/components/focus-mode";
import { ShareDialog } from "@/components/share-dialog";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Heartbeat" }] }),
  component: TasksPage,
});

type ViewMode = "list" | "board" | "calendar";

function TasksPage() {
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");

  const visibleBusinesses = useMemo(
    () => (activeId === ALL ? businesses : businesses.filter((b) => b.id === activeId)),
    [businesses, activeId],
  );

  const selectedList = lists.find((l) => l.id === selectedListId) ?? null;

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-4rem)]">
      <aside
        className={cn(
          "md:w-72 md:shrink-0 border-b md:border-b-0 md:border-r border-border bg-sidebar/30 md:overflow-auto",
          // On mobile, hide the spaces panel once a list is selected
          selectedList ? "hidden md:block" : "block",
        )}
      >
        <div className="p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Spaces</h2>
          {visibleBusinesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="space-y-3">
              {visibleBusinesses.map((b) => (
                <BusinessNode
                  key={b.id}
                  business={b}
                  folders={folders.filter((f) => f.business_id === b.id)}
                  lists={lists}
                  selectedListId={selectedListId}
                  onSelectList={setSelectedListId}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 md:overflow-auto">
        {!selectedList ? (
          <div className="h-full flex items-center justify-center text-muted-foreground p-6">
            <div className="text-center max-w-sm">
              <h1 className="text-2xl sm:text-3xl text-primary mb-2">Tasks</h1>
              <p>Pick a list {`${typeof window !== "undefined" && window.innerWidth < 768 ? "above" : "from the left"}`}, or add a folder and list to an account to get started.</p>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => setSelectedListId(null)}
              className="md:hidden text-sm text-muted-foreground px-4 pt-3 -mb-1"
            >
              ← All lists
            </button>
            <ListWorkspace
              list={selectedList}
              view={view}
              onViewChange={setView}
            />
          </>
        )}
      </main>
    </div>
  );
}


function BusinessNode({
  business,
  folders,
  lists,
  selectedListId,
  onSelectList,
}: {
  business: { id: string; name: string; color: string };
  folders: Folder[];
  lists: ListRow[];
  selectedListId: string | null;
  onSelectList: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: () => createFolder({ business_id: business.id, name: name.trim() }),
    onSuccess: () => {
      setName("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <li>
      <div className="flex items-center gap-1.5 group">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 flex-1 text-left px-1 py-1 rounded hover:bg-muted"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: business.color }} />
          <span className="text-sm font-medium">{business.name}</span>
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={() => setAdding(true)}
          title="Add folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <ul className="ml-5 mt-1 space-y-1">
          {folders.map((f) => (
            <FolderNode
              key={f.id}
              folder={f}
              lists={lists.filter((l) => l.folder_id === f.id)}
              selectedListId={selectedListId}
              onSelectList={onSelectList}
            />
          ))}
          {adding && (
            <li>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) add.mutate();
                }}
                className="flex gap-1"
              >
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => !name.trim() && setAdding(false)}
                  placeholder="Folder name"
                  className="h-7 text-sm"
                />
              </form>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function FolderNode({
  folder,
  lists,
  selectedListId,
  onSelectList,
}: {
  folder: Folder;
  lists: ListRow[];
  selectedListId: string | null;
  onSelectList: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [editName, setEditName] = useState(folder.name);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["lists"] });
  };

  const add = useMutation({
    mutationFn: () => createList({ folder_id: folder.id, name: name.trim() }),
    onSuccess: () => {
      setName("");
      setAdding(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rename = useMutation({
    mutationFn: () => updateFolder(folder.id, { name: editName.trim() }),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteFolder(folder.id),
    onSuccess: () => {
      invalidate();
      showUndoToast(`Folder "${folder.name}" deleted`, async () => {
        await restoreFolder(folder.id);
        invalidate();
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <li>
      <div className="flex items-center gap-1 group">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 flex-1 text-left px-1 py-1 rounded hover:bg-muted min-w-0"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {renaming ? (
            <Input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => rename.mutate()}
              onKeyDown={(e) => e.key === "Enter" && rename.mutate()}
              className="h-6 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm truncate">{folder.name}</span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setAdding(true)}>Add list</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditName(folder.name); setRenaming(true); }}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { if (confirm(`Delete "${folder.name}" and its lists?`)) del.mutate(); }}
              className="text-destructive"
            >Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <ul className="ml-5 mt-1 space-y-0.5">
          {lists.map((l) => (
            <ListNode
              key={l.id}
              list={l}
              selected={l.id === selectedListId}
              onSelect={() => onSelectList(l.id)}
            />
          ))}
          {adding && (
            <li>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) add.mutate();
                }}
              >
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => !name.trim() && setAdding(false)}
                  placeholder="List name"
                  className="h-7 text-sm"
                />
              </form>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ListNode({
  list,
  selected,
  onSelect,
}: {
  list: ListRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);

  const rename = useMutation({
    mutationFn: () => updateList(list.id, { name: name.trim() }),
    onSuccess: () => {
      setRenaming(false);
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteList(list.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      showUndoToast(`List "${list.name}" deleted`, async () => {
        await restoreList(list.id);
        qc.invalidateQueries({ queryKey: ["lists"] });
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <li className="flex items-center gap-1 group">
      <button
        onClick={onSelect}
        className={cn(
          "flex-1 text-left text-sm px-2 py-1 rounded hover:bg-muted truncate",
          selected && "bg-accent/15 text-accent font-medium",
        )}
      >
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => rename.mutate()}
            onKeyDown={(e) => e.key === "Enter" && rename.mutate()}
            className="h-6 text-sm"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          list.name
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100">
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setName(list.name); setRenaming(true); }}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => { if (confirm(`Delete "${list.name}" and its tasks?`)) del.mutate(); }}
            className="text-destructive"
          >Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// ---------- workspace ----------

type SortKey = "priority" | "due" | "created" | "title";
type DueFilter = "all" | "overdue" | "today" | "week" | "none";
type AssignedFilter = "all" | "me" | "by_me" | "unassigned";
type Filters = {
  priority: TaskPriority | "all";
  status: TaskStatus | "all";
  due: DueFilter;
  assigned: AssignedFilter;
};
const DEFAULT_FILTERS: Filters = { priority: "all", status: "all", due: "all", assigned: "all" };

function matchesFilters(t: Task, f: Filters, myId: string | null): boolean {
  if (f.priority !== "all" && t.priority !== f.priority) return false;
  if (f.status !== "all" && t.status !== f.status) return false;
  if (f.assigned !== "all" && myId) {
    if (f.assigned === "me" && t.assignee_id !== myId) return false;
    if (f.assigned === "by_me" && (t.assigned_by !== myId || !t.assignee_id || t.assignee_id === myId)) return false;
    if (f.assigned === "unassigned" && t.assignee_id) return false;
  }
  if (f.due !== "all") {
    if (f.due === "none") return !t.due_at;
    if (!t.due_at) return false;
    const d = new Date(t.due_at);
    const now = new Date();
    if (f.due === "overdue") return d < now && t.status !== "done";
    if (f.due === "today") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      return d >= start && d <= end;
    }
    if (f.due === "week") {
      const end = new Date(); end.setDate(end.getDate() + 7);
      return d <= end;
    }
  }
  return true;
}

function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const arr = [...tasks];
  arr.sort((a, b) => {
    switch (key) {
      case "priority": return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      case "due": {
        const ad = a.due_at ? +new Date(a.due_at) : Infinity;
        const bd = b.due_at ? +new Date(b.due_at) : Infinity;
        return ad - bd;
      }
      case "title": return a.title.localeCompare(b.title);
      case "created": return +new Date(a.created_at) - +new Date(b.created_at);
    }
  });
  return arr;
}

function ListWorkspace({
  list,
  view,
  onViewChange,
}: {
  list: ListRow;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}) {
  const qc = useQueryClient();
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const folder = folders.find((f) => f.id === list.folder_id);
  const businessId = folder?.business_id ?? null;

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", list.id],
    queryFn: () => listTasksByList(list.id),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", list.id] });

  const { user } = useAuth();
  const myId = user?.id ?? null;

  // Saved per-user view config for this list
  const viewCfgQuery = useQuery({
    queryKey: ["user_list_view", list.id, myId],
    queryFn: () => (myId ? fetchListView(list.id, myId) : Promise.resolve(null)),
    enabled: !!myId,
  });
  const savedCfg: ListViewConfig = viewCfgQuery.data ?? DEFAULT_VIEW_CONFIG;

  const [quickAdd, setQuickAdd] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [groupBy, setGroupBy] = useState<GroupByKey>("stage");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stageMgrOpen, setStageMgrOpen] = useState(false);

  // Hydrate local state when saved config loads (or list changes)
  const [hydratedListId, setHydratedListId] = useState<string | null>(null);
  if (viewCfgQuery.data && hydratedListId !== list.id) {
    const cfg = viewCfgQuery.data;
    setFilters({
      priority: cfg.filters.priority as Filters["priority"],
      status: cfg.filters.status as Filters["status"],
      due: cfg.filters.due as Filters["due"],
      assigned: cfg.filters.assigned as Filters["assigned"],
    });
    setSortKey(cfg.sort.key);
    setGroupBy(cfg.group_by);
    setCollapsedGroups(new Set(cfg.collapsed_groups));
    if (cfg.view !== view) onViewChange(cfg.view);
    setHydratedListId(list.id);
  } else if (!viewCfgQuery.data && !viewCfgQuery.isLoading && hydratedListId !== list.id) {
    setHydratedListId(list.id);
  }

  // Persist on changes
  const persistView = (patch: Partial<ListViewConfig>) => {
    if (!myId || hydratedListId !== list.id) return;
    saveListView(list.id, myId, patch).catch((e) =>
      console.error("saveListView failed", e),
    );
  };

  // Persist view mode + filters + sort whenever they change post-hydration
  useEffect(() => {
    if (!myId || hydratedListId !== list.id) return;
    saveListView(list.id, myId, { view, filters, sort: { key: sortKey } }).catch(
      (e) => console.error("saveListView failed", e),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filters, sortKey, list.id, myId, hydratedListId]);

  const create = useMutation({
    mutationFn: () =>
      createTask({
        list_id: list.id,
        business_id: businessId,
        title: quickAdd.trim(),
        position: tasks.length,
      }),
    onSuccess: () => {
      setQuickAdd("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filteredTopLevel = useMemo(() => {
    const top = tasks.filter((t) => !t.parent_task_id);
    return sortTasks(top.filter((t) => matchesFilters(t, filters, myId)), sortKey);
  }, [tasks, filters, sortKey, myId]);

  const subtasksByParent = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parent_task_id) {
        const arr = m.get(t.parent_task_id) ?? [];
        arr.push(t);
        m.set(t.parent_task_id, arr);
      }
    }
    return m;
  }, [tasks]);

  const [openTask, setOpenTask] = useState<Task | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const bulkStatus = useMutation({
    mutationFn: (status: TaskStatus) => bulkUpdateTasks([...selectedIds], { status }),
    onSuccess: () => { toast.success("Updated"); clearSelection(); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const bulkPriority = useMutation({
    mutationFn: (priority: TaskPriority) => bulkUpdateTasks([...selectedIds], { priority }),
    onSuccess: () => { toast.success("Updated"); clearSelection(); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const bulkDelete = useMutation({
    mutationFn: () => {
      const ids = [...selectedIds];
      return bulkDeleteTasks(ids).then(() => ids);
    },
    onSuccess: (ids) => {
      clearSelection();
      invalidate();
      showUndoToast(`${ids.length} task${ids.length === 1 ? "" : "s"} deleted`, async () => {
        await bulkRestoreTasks(ids);
        invalidate();
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const activeFilterCount =
    (filters.priority !== "all" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.due !== "all" ? 1 : 0) +
    (filters.assigned !== "all" ? 1 : 0);

  const { data: members = [] } = useAssignableMembers(businessId);
  const memberList = members as AssignableMember[];
  const { data: stages = [] } = useQuery({
    queryKey: ["task_stages", list.id],
    queryFn: () => fetchStages(list.id),
  });

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      persistView({ collapsed_groups: [...n] });
      return n;
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <h1 className="text-2xl sm:text-3xl text-primary">{list.name}</h1>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            ["list", LayoutList, "List"],
            ["board", Columns, "Board"],
            ["calendar", CalendarDays, "Calendar"],
          ] as const).map(([k, Icon, label]) => (
            <button
              key={k}
              onClick={() => onViewChange(k)}
              className={cn(
                "px-3 py-1.5 text-sm flex items-center gap-1.5",
                view === k ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (quickAdd.trim()) create.mutate();
        }}
        className="mb-3 mt-4"
      >
        <Input
          placeholder="Quick add — type a task, press Enter"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
        />
      </form>

      {/* Filters + sort toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-3.5 w-3.5" /> Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{activeFilterCount}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">Priority</DropdownMenuLabel>
            {(["all", "urgent", "high", "normal", "low"] as const).map((p) => (
              <DropdownMenuItem key={p} onClick={() => setFilters((f) => ({ ...f, priority: p }))}>
                {p === "all" ? "All priorities" : PRIORITY_LABEL[p]}
                {filters.priority === p && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
            {(["all", "todo", "in_progress", "review", "done"] as const).map((s) => (
              <DropdownMenuItem key={s} onClick={() => setFilters((f) => ({ ...f, status: s }))}>
                {s === "all" ? "All statuses" : STATUS_LABEL[s]}
                {filters.status === s && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Due date</DropdownMenuLabel>
            {([
              ["all", "Any time"],
              ["overdue", "Overdue"],
              ["today", "Due today"],
              ["week", "Next 7 days"],
              ["none", "No due date"],
            ] as const).map(([k, label]) => (
              <DropdownMenuItem key={k} onClick={() => setFilters((f) => ({ ...f, due: k }))}>
                {label}
                {filters.due === k && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Assignment</DropdownMenuLabel>
            {([
              ["all", "Anyone"],
              ["me", "Assigned to me"],
              ["by_me", "Assigned by me"],
              ["unassigned", "Unassigned"],
            ] as const).map(([k, label]) => (
              <DropdownMenuItem key={k} onClick={() => setFilters((f) => ({ ...f, assigned: k }))}>
                {label}
                {filters.assigned === k && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear all filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Layers className="h-3.5 w-3.5" /> Group:{" "}
              {groupBy === "stage" ? "Stage" :
               groupBy === "priority" ? "Priority" :
               groupBy === "assignee" ? "Assignee" :
               groupBy === "due" ? "Due date" : "None"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {([
              ["stage", "Stage"],
              ["priority", "Priority"],
              ["assignee", "Assignee"],
              ["due", "Due date"],
              ["none", "None"],
            ] as const).map(([k, label]) => (
              <DropdownMenuItem
                key={k}
                onClick={() => {
                  setGroupBy(k);
                  persistView({ group_by: k });
                }}
              >
                {label}
                {groupBy === k && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {view === "board" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStageMgrOpen(true)}
            title="Add, rename, recolour, or reorder stages"
          >
            <Settings2 className="h-3.5 w-3.5" /> Stages
          </Button>
        )}


        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowUpDown className="h-3.5 w-3.5" /> Sort: {sortKey === "priority" ? "Priority" : sortKey === "due" ? "Due date" : sortKey === "title" ? "Title" : "Created"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {([
              ["priority", "Priority"],
              ["due", "Due date"],
              ["title", "Title (A–Z)"],
              ["created", "Created (oldest first)"],
            ] as const).map(([k, label]) => (
              <DropdownMenuItem key={k} onClick={() => setSortKey(k)}>
                {label}{sortKey === k && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-xs text-muted-foreground ml-auto">
          {filteredTopLevel.length} of {tasks.filter((t) => !t.parent_task_id).length} task{tasks.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 mb-4 p-2 rounded-lg border border-accent/30 bg-accent/5 flex-wrap">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <CheckSquare className="h-4 w-4" /> {selectedIds.size} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STATUSES.map((s) => (
                <DropdownMenuItem key={s.value} onClick={() => bulkStatus.mutate(s.value)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Priority</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(["urgent", "high", "normal", "low"] as TaskPriority[]).map((p) => (
                <DropdownMenuItem key={p} onClick={() => bulkPriority.mutate(p)}>
                  <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[p] }} /> {PRIORITY_LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => { if (confirm(`Delete ${selectedIds.size} task${selectedIds.size === 1 ? "" : "s"}?`)) bulkDelete.mutate(); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      )}

      {view === "list" && (
        <ListView
          tasks={filteredTopLevel}
          subtasksByParent={subtasksByParent}
          listId={list.id}
          businessId={businessId}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onChange={invalidate}
          onOpen={setOpenTask}
          groupBy={groupBy}
          stages={stages}
          members={memberList}
          myId={myId}
          collapsedGroups={collapsedGroups}
          onToggleCollapsed={toggleGroupCollapsed}
        />
      )}
      {view === "board" && (
        <BoardView
          listId={list.id}
          tasks={filteredTopLevel}
          onChange={invalidate}
          onOpen={setOpenTask}
          onManageStages={() => setStageMgrOpen(true)}
        />
      )}
      {view === "calendar" && (
        <TaskCalendarView tasks={filteredTopLevel} onOpen={setOpenTask} />
      )}

      <StageManagerDialog
        listId={list.id}
        open={stageMgrOpen}
        onOpenChange={setStageMgrOpen}
      />


      {openTask && (
        <TaskDialog
          task={openTask}
          onClose={() => setOpenTask(null)}
          onChange={invalidate}
        />
      )}
    </div>
  );
}

// ---------- List view ----------

function ListView({
  tasks,
  subtasksByParent,
  listId,
  businessId,
  selectedIds,
  onToggleSelect,
  onChange,
  onOpen,
  groupBy = "stage",
  stages = [],
  members = [],
  myId = null,
  collapsedGroups,
  onToggleCollapsed,
}: {
  tasks: Task[];
  subtasksByParent: Map<string, Task[]>;
  listId: string;
  businessId: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onChange: () => void;
  onOpen: (t: Task) => void;
  groupBy?: GroupByKey;
  stages?: TaskStage[];
  members?: AssignableMember[];
  myId?: string | null;
  collapsedGroups: Set<string>;
  onToggleCollapsed: (key: string) => void;
}) {
  const qc = useQueryClient();
  const groups: TaskGroup[] = groupTasks(tasks, groupBy, {
    stages,
    members,
    myId,
  });

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const collapsed = collapsedGroups.has(g.key);
        return (
          <div key={g.key}>
            <button
              type="button"
              onClick={() => onToggleCollapsed(g.key)}
              className="w-full flex items-center gap-2 mb-2 text-left group/header"
            >
              {collapsed ? (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              )}
              {g.color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: g.color }}
                />
              )}
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                {g.label}{" "}
                <span className="text-foreground/40">{g.items.length}</span>
              </h3>
            </button>
            {!collapsed && (
              <>
                <div
                  className="rounded-xl border border-border bg-card divide-y divide-border"
                  style={{ boxShadow: "var(--shadow-soft)" }}
                >
                  {g.items.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>
                  ) : (
                    g.items.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        subtasks={subtasksByParent.get(t.id) ?? []}
                        listId={listId}
                        businessId={businessId}
                        selected={selectedIds.has(t.id)}
                        onToggleSelect={() => onToggleSelect(t.id)}
                        onChange={onChange}
                        onOpen={onOpen}
                        members={members}
                        myId={myId}
                      />
                    ))
                  )}
                </div>
                <GroupAddTask
                  listId={listId}
                  businessId={businessId}
                  groupBy={groupBy}
                  groupKey={g.key}
                  position={tasks.length}
                  onAdded={() => {
                    qc.invalidateQueries({ queryKey: ["tasks", listId] });
                    onChange();
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupAddTask({
  listId,
  businessId,
  groupBy,
  groupKey,
  position,
  onAdded,
}: {
  listId: string;
  businessId: string | null;
  groupBy: GroupByKey;
  groupKey: string;
  position: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const patch: Parameters<typeof createTask>[0] = {
        list_id: listId,
        business_id: businessId,
        title: title.trim(),
        position,
      };
      if (groupBy === "stage" && groupKey !== "__all__") {
        patch.stage_id = groupKey;
      } else if (groupBy === "priority") {
        patch.priority = groupKey as TaskPriority;
      } else if (groupBy === "assignee" && groupKey !== "__unassigned__") {
        patch.assignee_id = groupKey;
      }
      return createTask(patch);
    },
    onSuccess: () => {
      setTitle("");
      setOpen(false);
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-xs text-muted-foreground hover:text-accent flex items-center gap-1 px-2 py-1 rounded"
      >
        <Plus className="h-3 w-3" /> Add task
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
      className="mt-1.5"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder="Task title — Enter to add"
        className="h-7 text-sm"
      />
    </form>
  );
}


function TaskRow({
  task,
  subtasks,
  listId,
  businessId,
  selected,
  onToggleSelect,
  onChange,
  onOpen,
  members = [],
  myId = null,
}: {
  task: Task;
  subtasks: Task[];
  listId: string;
  businessId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  onChange: () => void;
  onOpen: (t: Task) => void;
  members?: AssignableMember[];
  myId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const [focusOn, setFocusOn] = useState(false);

  const toggle = useMutation({
    mutationFn: async () => {
      const nowDone = task.status !== "done";
      await updateTask(task.id, { status: nowDone ? "done" : "todo" });
      if (nowDone && task.recurrence_rule) {
        await rolloverRecurring(task);
      }
    },
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      onChange();
      showUndoToast(`Task "${task.title}" deleted`, async () => {
        await restoreTask(task.id);
        onChange();
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const addSub = useMutation({
    mutationFn: () =>
      createTask({
        list_id: listId,
        business_id: businessId,
        parent_task_id: task.id,
        title: subTitle.trim(),
        position: subtasks.length,
      }),
    onSuccess: () => {
      setSubTitle("");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const overdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "done";

  return (
    <>
      {focusOn && (
        <FocusMode task={task} onClose={() => setFocusOn(false)} onChange={onChange} />
      )}
    <div className={cn(selected && "bg-accent/5")}>
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Select task"
          className="opacity-60 hover:opacity-100"
        />
        <button
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Expand subtasks"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Checkbox checked={task.status === "done"} onCheckedChange={() => toggle.mutate()} aria-label="Mark done" />
        <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
        <button
          onClick={() => onOpen(task)}
          className={cn("flex-1 text-left text-sm truncate hover:text-accent", task.status === "done" && "line-through text-muted-foreground")}
        >
          {task.title}
          {task.recurrence_rule && (
            <Repeat className="inline-block h-3 w-3 ml-1.5 text-muted-foreground" />
          )}
          {subtasks.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">{subtasks.filter((s) => s.status === "done").length}/{subtasks.length}</span>
          )}
        </button>
        {task.assignee_id && (
          <Badge
            variant={task.assignee_id === myId ? "default" : "secondary"}
            className="text-[10px] gap-1 px-1.5"
            title={task.assignee_id === myId && task.assigned_by && task.assigned_by !== myId
              ? `Assigned to you by ${memberLabel(members, task.assigned_by)}`
              : `Assigned to ${memberLabel(members, task.assignee_id)}`}
          >
            <UserCircle2 className="h-3 w-3" />
            {task.assignee_id === myId ? "You" : memberLabel(members, task.assignee_id).split(" ")[0]}
          </Badge>
        )}
        {task.due_at && (
          <span className={cn("text-xs flex items-center gap-1", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
            <CalIcon className="h-3 w-3" />
            {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        <TaskTimerInline taskId={task.id} businessId={businessId} />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setFocusOn(true)}
          title="Focus mode"
        >
          <Focus className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => del.mutate()} title="Delete task">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
      {open && (
        <div className="pl-12 pr-4 pb-3 space-y-1.5">
          {subtasks.map((s) => (
            <SubtaskRow key={s.id} task={s} onChange={onChange} />
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (subTitle.trim()) addSub.mutate();
            }}
          >
            <Input
              placeholder="Add subtask…"
              value={subTitle}
              onChange={(e) => setSubTitle(e.target.value)}
              className="h-7 text-sm"
            />
          </form>
        </div>
      )}
    </div>
    </>
  );
}

function SubtaskRow({ task, onChange }: { task: Task; onChange: () => void }) {
  const toggle = useMutation({
    mutationFn: () => updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update subtask"),
  });
  const del = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      onChange();
      showUndoToast(`Subtask "${task.title}" deleted`, async () => {
        await restoreTask(task.id);
        onChange();
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete subtask"),
  });
  return (
    <div className="flex items-center gap-2 group">
      <Checkbox checked={task.status === "done"} onCheckedChange={() => toggle.mutate()} />
      <span className={cn("text-sm flex-1", task.status === "done" && "line-through text-muted-foreground")}>
        {task.title}
      </span>
      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => del.mutate()}>
        <Trash2 className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

// ---------- Board view (kanban: stage-driven, drag tasks + columns) ----------

const COLUMN_PREFIX = "col:";
const TASK_PREFIX = "task:";

function BoardView({
  listId,
  tasks,
  onChange,
  onOpen,
  onManageStages,
}: {
  listId: string;
  tasks: Task[];
  onChange: () => void;
  onOpen: (t: Task) => void;
  onManageStages: () => void;
}) {
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const stagesQuery = useQuery({
    queryKey: ["task_stages", listId],
    queryFn: () => fetchStages(listId),
  });
  const stages = stagesQuery.data ?? [];

  // Group tasks by stage (fallback: any task with no stage_id buckets under the first stage)
  const tasksByStage = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const s of stages) map.set(s.id, []);
    const firstId = stages[0]?.id;
    for (const t of tasks) {
      const sid = t.stage_id ?? firstId;
      if (!sid) continue;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(t);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.stage_position - b.stage_position);
    }
    return map;
  }, [tasks, stages]);

  const reorderColumns = useMutation({
    mutationFn: reorderStages,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task_stages", listId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const moveTask = useMutation({
    mutationFn: ({ id, stageId, pos }: { id: string; stageId: string; pos: number }) =>
      moveTaskToStage(id, stageId, pos),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reorderInStage = useMutation({
    mutationFn: reorderTasksInStage,
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;

    // Column reorder
    if (activeId.startsWith(COLUMN_PREFIX) && overId.startsWith(COLUMN_PREFIX)) {
      const a = activeId.slice(COLUMN_PREFIX.length);
      const o = overId.slice(COLUMN_PREFIX.length);
      const oldIdx = stages.findIndex((s) => s.id === a);
      const newIdx = stages.findIndex((s) => s.id === o);
      if (oldIdx < 0 || newIdx < 0) return;
      const next = arrayMove(stages, oldIdx, newIdx).map((s) => s.id);
      // Optimistic
      qc.setQueryData<TaskStage[]>(
        ["task_stages", listId],
        arrayMove(stages, oldIdx, newIdx).map((s, i) => ({ ...s, position: i })),
      );
      reorderColumns.mutate(next);
      return;
    }

    // Task drag
    if (!activeId.startsWith(TASK_PREFIX)) return;
    const taskId = activeId.slice(TASK_PREFIX.length);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Dropped on a column (empty area)
    let targetStageId: string | null = null;
    let targetIndex = -1;
    if (overId.startsWith(COLUMN_PREFIX)) {
      targetStageId = overId.slice(COLUMN_PREFIX.length);
      targetIndex = (tasksByStage.get(targetStageId) ?? []).length;
    } else if (overId.startsWith(TASK_PREFIX)) {
      const overTaskId = overId.slice(TASK_PREFIX.length);
      const overTask = tasks.find((t) => t.id === overTaskId);
      if (!overTask?.stage_id) return;
      targetStageId = overTask.stage_id;
      const arr = tasksByStage.get(targetStageId) ?? [];
      targetIndex = arr.findIndex((t) => t.id === overTaskId);
      if (targetIndex < 0) targetIndex = arr.length;
    }
    if (!targetStageId) return;

    const sameStage = task.stage_id === targetStageId;
    const arr = tasksByStage.get(targetStageId) ?? [];

    if (sameStage) {
      const fromIdx = arr.findIndex((t) => t.id === taskId);
      if (fromIdx < 0 || fromIdx === targetIndex) return;
      const next = arrayMove(arr, fromIdx, targetIndex);
      reorderInStage.mutate(next.map((t) => t.id));
    } else {
      // Insert into target column at targetIndex; cascade positions
      const next = [...arr];
      next.splice(targetIndex, 0, { ...task, stage_id: targetStageId, stage_position: targetIndex });
      moveTask.mutate({ id: taskId, stageId: targetStageId, pos: targetIndex });
      // Renumber the rest of the column behind the scenes
      const ids = next.map((t) => t.id);
      // Fire-and-forget; moveTask already handles the dragged task itself
      reorderInStage.mutate(ids);
    }
  }

  if (stagesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading board…</p>;
  }
  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          No stages yet. Stages organise your board columns.
        </p>
        <Button size="sm" onClick={onManageStages}>
          <Plus className="h-3.5 w-3.5" /> Set up stages
        </Button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="-mx-4 sm:mx-0 overflow-x-auto pb-2">
        <SortableContext
          items={stages.map((s) => COLUMN_PREFIX + s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex gap-3 px-4 sm:px-0 min-w-max">
            {stages.map((stage) => {
              const items = tasksByStage.get(stage.id) ?? [];
              return (
                <SortableColumn
                  key={stage.id}
                  stage={stage}
                  count={items.length}
                >
                  <SortableContext
                    items={items.map((t) => TASK_PREFIX + t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.length === 0 ? (
                      <div className="text-xs text-muted-foreground/60 px-2 py-3 italic">
                        Drop here
                      </div>
                    ) : (
                      items.map((t) => (
                        <SortableCard key={t.id} task={t} onOpen={onOpen} />
                      ))
                    )}
                  </SortableContext>
                </SortableColumn>
              );
            })}
            <button
              type="button"
              onClick={onManageStages}
              className="w-72 shrink-0 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-accent hover:border-accent/40 transition-colors flex items-center justify-center gap-1.5 min-h-[120px]"
            >
              <Plus className="h-4 w-4" /> Add or edit stages
            </button>
          </div>
        </SortableContext>
      </div>
    </DndContext>
  );
}

function SortableColumn({
  stage,
  count,
  children,
}: {
  stage: TaskStage;
  count: number;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: COLUMN_PREFIX + stage.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: COLUMN_PREFIX + stage.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="w-72 shrink-0">
      <div
        ref={setDropRef}
        className={cn(
          "rounded-xl border border-border bg-card p-3 min-h-[400px] transition-colors flex flex-col",
          isOver && "border-accent bg-accent/5",
        )}
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        <div
          {...attributes}
          {...listeners}
          className="flex items-center gap-2 mb-3 cursor-grab active:cursor-grabbing select-none"
        >
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: stage.color }}
            aria-hidden
          />
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground truncate">
            {stage.name}
          </h3>
          <span className="text-xs text-foreground/40 ml-auto tabular-nums">
            {count}
          </span>
        </div>
        <div className="space-y-2 flex-1">{children}</div>
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: TASK_PREFIX + task.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const overdue =
    task.due_at && new Date(task.due_at) < new Date() && task.status !== "done";
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && onOpen(task)}
      className={cn(
        "rounded-lg border border-border bg-background p-2.5 text-sm cursor-grab active:cursor-grabbing",
        isDragging && "shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <Flag
          className="h-3 w-3 mt-1 shrink-0"
          style={{ color: PRIORITY_COLOR[task.priority] }}
        />
        <span className="flex-1">{task.title}</span>
      </div>
      {task.due_at && (
        <div
          className={cn(
            "text-xs mt-1.5 flex items-center gap-1",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <CalIcon className="h-3 w-3" />
          {new Date(task.due_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Calendar view ----------

function TaskCalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const [cursor, setCursor] = useState(new Date());
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startGrid = new Date(first);
  startGrid.setDate(startGrid.getDate() - startGrid.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startGrid);
    d.setDate(startGrid.getDate() + i);
    return d;
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tasksByDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_at) continue;
    const d = new Date(t.due_at);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    const arr = tasksByDay.get(key) ?? [];
    arr.push(t);
    tasksByDay.set(key, arr);
  }

  return (
    <div>
      <div className="inline-flex items-stretch rounded-lg border border-border overflow-hidden mb-3">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Previous month"
          className="px-2.5 hover:bg-muted min-h-[36px] inline-flex items-center justify-center"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => setCursor(new Date())}
          className="px-3 text-sm border-x border-border hover:bg-muted min-h-[36px]"
        >
          Today
        </button>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Next month"
          className="px-2.5 hover:bg-muted min-h-[36px] inline-flex items-center justify-center"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="px-3 text-sm self-center text-muted-foreground">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-soft)" }}>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
                <div key={w} className="px-2 py-2 text-center">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 grid-rows-6">
              {days.map((d, i) => {
                const inMonth = d.getMonth() === cursor.getMonth();
                const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
                const dayTasks = tasksByDay.get(dayKey) ?? [];
                const isToday = +d === +today;
                return (
                  <div
                    key={i}
                    className={cn(
                      "min-h-[90px] border-r border-b border-border p-1.5 flex flex-col gap-0.5",
                      (i + 1) % 7 === 0 && "border-r-0",
                      i >= 35 && "border-b-0",
                      !inMonth && "bg-muted/20",
                    )}
                  >
                    <span className={cn(
                      "text-xs self-end px-1.5 py-0.5 rounded-full",
                      isToday && "bg-accent text-accent-foreground font-semibold",
                      !inMonth && "text-muted-foreground",
                    )}>{d.getDate()}</span>
                    {dayTasks.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onOpen(t)}
                        className="text-[11px] truncate rounded px-1 py-0.5 text-left hover:bg-muted"
                        style={{ borderLeft: `2px solid ${PRIORITY_COLOR[t.priority]}` }}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ---------- Task detail dialog ----------

function TaskDialog({ task, onClose, onChange }: { task: Task; onClose: () => void; onChange: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState<string>(task.due_at ? task.due_at.slice(0, 10) : "");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | "none">(task.recurrence_rule ?? "none");
  const [outcomeId, setOutcomeId] = useState<string>(task.outcome_id ?? "");
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assignee_id);
  const [celebrate, setCelebrate] = useState<{ outcomeId: string; name: string } | null>(null);
  const [focusOn, setFocusOn] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const dueIso = dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null;

  // Outcomes for this task's account (or personal if no business)
  const { data: outcomes = [] } = useQuery({
    queryKey: ["outcomes-for-task", task.business_id],
    queryFn: () => listOutcomes(task.business_id),
  });
  const { data: assignHistory = [] } = useQuery({
    queryKey: ["task-assignment-history", task.id],
    queryFn: () => listAssignmentHistory(task.id),
  });
  const { data: members = [] } = useAssignableMembers(task.business_id);
  const memberList = members as AssignableMember[];
  const activeOutcomes = outcomes.filter(
    (o) => o.status === "active" || o.id === task.outcome_id,
  );

  const save = useMutation({
    mutationFn: async () => {
      const nextOutcomeId = outcomeId || null;
      await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_at: dueIso,
        recurrence_rule: recurrence === "none" ? null : recurrence,
        recurrence_anchor: recurrence === "none" ? null : (dueIso ?? task.recurrence_anchor),
        outcome_id: nextOutcomeId,
      });
      // Apply assignment change separately so the BEFORE trigger validates & stamps assigner.
      if (assigneeId !== task.assignee_id) {
        await assignTask({ task_id: task.id, assignee_id: assigneeId });
      }

      // If this completion closes out an outcome, offer to celebrate
      const wasOpen = task.status !== "done";
      const nowDone = status === "done";
      if (nowDone && wasOpen && nextOutcomeId) {
        const { data: remaining } = await supabase
          .from("tasks")
          .select("id")
          .eq("outcome_id", nextOutcomeId)
          .is("deleted_at", null)
          .neq("status", "done")
          .neq("id", task.id)
          .limit(1);
        if ((remaining ?? []).length === 0) {
          const o = outcomes.find((x) => x.id === nextOutcomeId);
          if (o && o.status === "active") {
            return { celebrate: { outcomeId: o.id, name: o.name } as const };
          }
        }
      }
      return { celebrate: null as { outcomeId: string; name: string } | null };
    },
    onSuccess: (res) => {
      toast.success("Saved");
      onChange();
      if (res.celebrate) {
        setCelebrate(res.celebrate);
      } else {
        onClose();
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const { data: activity = [] } = useQuery({
    queryKey: ["task-activity", task.id],
    queryFn: () => listTaskActivity(task.id),
  });

  const { data: backlinks = [] } = useQuery({
    queryKey: ["task-backlinks", task.id],
    queryFn: async () => {
      const links = await listBacklinks("task", task.id);
      return resolveLinks(links);
    },
  });

  // Source note (set when task was created from a note via Notes -> Tasks bridge)
  const { data: sourceNote = null } = useQuery({
    queryKey: ["task-source-note", task.source_note_id],
    queryFn: async () => {
      if (!task.source_note_id) return null;
      const { data } = await supabase
        .from("notes")
        .select("id,title")
        .eq("id", task.source_note_id)
        .is("deleted_at", null)
        .maybeSingle();
      return data as { id: string; title: string } | null;
    },
    enabled: !!task.source_note_id,
  });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Task details</span>
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                Share
              </Button>
            </DialogTitle>
          </DialogHeader>
          <ShareDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            resourceType="task"
            resourceId={task.id}
            resourceName={task.title}
          />
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["urgent", "high", "normal", "low"] as TaskPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="inline-flex items-center gap-2">
                          <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[p] }} />
                          {PRIORITY_LABEL[p]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Due date</Label>
                <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
              <div>
                <Label className="flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" /> Repeats</Label>
                <Select value={recurrence} onValueChange={(v) => setRecurrence(v as RecurrenceRule | "none")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Does not repeat</SelectItem>
                    {(Object.keys(RECURRENCE_LABEL) as RecurrenceRule[]).map((r) => (
                      <SelectItem key={r} value={r}>{RECURRENCE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {recurrence !== "none" && !dueAt && (
              <p className="text-xs text-muted-foreground -mt-2">Add a due date so the next occurrence has a target.</p>
            )}

            <div>
              <Label className="flex items-center gap-1.5"><UserCircle2 className="h-3.5 w-3.5" /> Assignee</Label>
              <AssigneePicker
                businessId={task.business_id}
                value={assigneeId}
                onChange={setAssigneeId}
              />
              {assigneeId && task.business_id && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  They'll be notified and the task will appear on their Today and My Week.
                </p>
              )}
            </div>

            <div>
              <Label>Outcome</Label>
              <Select
                value={outcomeId || "__none"}
                onValueChange={(v) => setOutcomeId(v === "__none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="No outcome" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No outcome</SelectItem>
                  {activeOutcomes.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeOutcomes.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No outcomes yet for this account. Create one in Outcomes to roll tasks up.
                </p>
              )}
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Add context, links, or instructions…"
              />
            </div>

            <div className="pt-2 border-t border-border">
              <ReminderControls refType="task" refId={task.id} anchorAt={dueIso} />
            </div>

            <TaskTimePanel taskId={task.id} businessId={task.business_id} />

            <div className="pt-2 border-t border-border">
              <TagPeople itemType="task" itemId={task.id} businessId={task.business_id} />
            </div>

            {/* Linked notes/meetings/events */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Link2 className="h-4 w-4" /> <span>Linked from notes</span>
              </div>
              {backlinks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No notes link to this task yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {backlinks.map((b) => (
                    <li key={b.id} className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">note</Badge>
                      <span className="truncate">{b.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Activity & comments */}
            <div className="pt-2 border-t border-border">
              <ActivityAndComments
                parentType="task"
                parentId={task.id}
                businessId={task.business_id}
                activity={[
                  ...activity.map((a) => ({
                    id: a.id,
                    at: a.changed_at,
                    label: `${a.from_status ? `${STATUS_LABEL[a.from_status]} → ` : ""}${STATUS_LABEL[a.to_status]}`,
                  })),
                  ...assignHistory.map((h) => ({
                    id: `assign-${h.id}`,
                    at: h.changed_at,
                    label: h.to_assignee
                      ? `Assigned to ${memberLabel(memberList, h.to_assignee)}${h.changed_by ? ` by ${memberLabel(memberList, h.changed_by)}` : ""}`
                      : `Unassigned${h.changed_by ? ` by ${memberLabel(memberList, h.changed_by)}` : ""}`,
                  })),
                ]}
              />
            </div>

          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setFocusOn(true)}>
              <Focus className="h-4 w-4 mr-1.5" /> Focus
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {celebrate && (
        <CelebrateOutcomeDialog
          outcomeId={celebrate.outcomeId}
          name={celebrate.name}
          onDone={() => {
            setCelebrate(null);
            onChange();
            onClose();
          }}
        />
      )}
      {focusOn && (
        <FocusMode
          task={task}
          onClose={() => setFocusOn(false)}
          onChange={onChange}
        />
      )}
    </>
  );
}

function CelebrateOutcomeDialog({
  outcomeId,
  name,
  onDone,
}: {
  outcomeId: string;
  name: string;
  onDone: () => void;
}) {
  const mark = useMutation({
    mutationFn: () => updateOutcome(outcomeId, { status: "achieved" }),
    onSuccess: () => {
      toast.success(`Outcome achieved: ${name}`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="sm:max-w-md text-center">
        <DialogHeader>
          <DialogTitle className="text-center">That was the last one.</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="text-5xl">🌿</div>
          <p className="text-sm text-muted-foreground">
            Every task linked to <span className="font-medium text-foreground">{name}</span> is done.
            Mark this outcome as achieved?
          </p>
        </div>
        <DialogFooter className="sm:justify-center gap-2">
          <Button variant="outline" onClick={onDone}>Not yet</Button>
          <Button onClick={() => mark.mutate()} disabled={mark.isPending}>
            {mark.isPending ? "Saving…" : "Mark achieved"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
