import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Flag,
  Calendar as CalIcon,
  LayoutList,
  Columns,
  CalendarDays,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  createFolder,
  createList,
  createTask,
  deleteFolder,
  deleteList,
  deleteTask,
  listFolders,
  listLists,
  listTasksByList,
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  STATUSES,
  updateFolder,
  updateList,
  updateTask,
  type Folder,
  type ListRow,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskTimerInline, TaskTimePanel } from "@/components/task-timer";

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
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-72 shrink-0 border-r border-border bg-sidebar/30 overflow-auto">
        <div className="p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Spaces</h2>
          {visibleBusinesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No businesses yet.</p>
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

      <main className="flex-1 min-w-0 overflow-auto">
        {!selectedList ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center max-w-sm">
              <h1 className="text-3xl text-primary mb-2">Tasks</h1>
              <p>Pick a list from the left, or add a folder and list to a business to get started.</p>
            </div>
          </div>
        ) : (
          <ListWorkspace
            list={selectedList}
            view={view}
            onViewChange={setView}
          />
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
    onSuccess: invalidate,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
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

  const [quickAdd, setQuickAdd] = useState("");
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

  const topLevel = tasks.filter((t) => !t.parent_task_id);
  const subtasksByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_task_id) {
      const arr = subtasksByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      subtasksByParent.set(t.parent_task_id, arr);
    }
  }

  const [openTask, setOpenTask] = useState<Task | null>(null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <h1 className="text-3xl text-primary">{list.name}</h1>
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
        className="mb-6 mt-4"
      >
        <Input
          placeholder="Quick add — type a task, hit Enter"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
        />
      </form>

      {view === "list" && (
        <ListView
          tasks={topLevel}
          subtasksByParent={subtasksByParent}
          listId={list.id}
          businessId={businessId}
          onChange={invalidate}
          onOpen={setOpenTask}
        />
      )}
      {view === "board" && (
        <BoardView
          tasks={topLevel}
          onChange={invalidate}
          onOpen={setOpenTask}
        />
      )}
      {view === "calendar" && (
        <TaskCalendarView tasks={topLevel} onOpen={setOpenTask} />
      )}

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
  onChange,
  onOpen,
}: {
  tasks: Task[];
  subtasksByParent: Map<string, Task[]>;
  listId: string;
  businessId: string | null;
  onChange: () => void;
  onOpen: (t: Task) => void;
}) {
  const grouped = STATUSES.map((s) => ({
    status: s,
    items: tasks
      .filter((t) => t.status === s.value)
      .sort((a, b) => {
        const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (p !== 0) return p;
        const ad = a.due_at ? +new Date(a.due_at) : Infinity;
        const bd = b.due_at ? +new Date(b.due_at) : Infinity;
        return ad - bd;
      }),
  }));

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <div key={g.status.value}>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {g.status.label} <span className="text-foreground/40">{g.items.length}</span>
          </h3>
          <div className="rounded-xl border border-border bg-card divide-y divide-border" style={{ boxShadow: "var(--shadow-soft)" }}>
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
                  onChange={onChange}
                  onOpen={onOpen}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskRow({
  task,
  subtasks,
  listId,
  businessId,
  onChange,
  onOpen,
}: {
  task: Task;
  subtasks: Task[];
  listId: string;
  businessId: string | null;
  onChange: () => void;
  onOpen: (t: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subTitle, setSubTitle] = useState("");

  const toggle = useMutation({
    mutationFn: () => updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: onChange,
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
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Expand subtasks"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Checkbox checked={task.status === "done"} onCheckedChange={() => toggle.mutate()} />
        <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
        <button
          onClick={() => onOpen(task)}
          className={cn("flex-1 text-left text-sm truncate hover:text-accent", task.status === "done" && "line-through text-muted-foreground")}
        >
          {task.title}
          {subtasks.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">{subtasks.filter((s) => s.status === "done").length}/{subtasks.length}</span>
          )}
        </button>
        {task.due_at && (
          <span className={cn("text-xs flex items-center gap-1", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
            <CalIcon className="h-3 w-3" />
            {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        <TaskTimerInline taskId={task.id} businessId={businessId} />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => del.mutate()}>
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
  );
}

function SubtaskRow({ task, onChange }: { task: Task; onChange: () => void }) {
  const toggle = useMutation({
    mutationFn: () => updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: onChange,
  });
  const del = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: onChange,
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

// ---------- Board view (kanban with dnd-kit) ----------

function BoardView({
  tasks,
  onChange,
  onOpen,
}: {
  tasks: Task[];
  onChange: () => void;
  onOpen: (t: Task) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => updateTask(id, { status }),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  function onDragEnd(e: DragEndEvent) {
    const taskId = e.active.id as string;
    const overId = e.over?.id as string | undefined;
    if (!overId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === overId) return;
    if (!STATUSES.find((s) => s.value === overId)) return;
    setStatus.mutate({ id: taskId, status: overId as TaskStatus });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-4 gap-3">
        {STATUSES.map((s) => (
          <BoardColumn key={s.value} status={s.value} label={s.label}>
            {tasks
              .filter((t) => t.status === s.value)
              .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
              .map((t) => (
                <BoardCard key={t.id} task={t} onOpen={onOpen} />
              ))}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({ status, label, children }: { status: TaskStatus; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border border-border bg-card p-3 min-h-[400px] transition-colors",
        isOver && "border-accent bg-accent/5",
      )}
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{label}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BoardCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;
  const overdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "done";
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => !isDragging && onOpen(task)}
      className={cn(
        "rounded-lg border border-border bg-background p-2.5 text-sm cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <Flag className="h-3 w-3 mt-1 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
        <span className="flex-1">{task.title}</span>
      </div>
      {task.due_at && (
        <div className={cn("text-xs mt-1.5 flex items-center gap-1", overdue ? "text-destructive" : "text-muted-foreground")}>
          <CalIcon className="h-3 w-3" />
          {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
      <div className="flex items-center gap-2 mb-3">
        <Button size="sm" variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
        <span className="text-sm">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <Button size="sm" variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-soft)" }}>
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
  );
}

// ---------- Task detail dialog ----------

function TaskDialog({ task, onClose, onChange }: { task: Task; onClose: () => void; onChange: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState<string>(task.due_at ? task.due_at.slice(0, 10) : "");

  const save = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_at: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success("Saved");
      onChange();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                        {p}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
          <TaskTimePanel taskId={task.id} businessId={task.business_id} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
