import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Flag, GripVertical, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  type Task,
} from "@/lib/tasks";
import {
  listBacklog,
  listCommitted,
  commitTasks,
  uncommitTasks,
  hasEstimate,
} from "@/lib/weekly-plan";
import { cn } from "@/lib/utils";

type Zone = "backlog" | "committed";

type Props = {
  weekStart: string;
  /** Called after a successful commit/uncommit so the parent can invalidate everything. */
  onMutated?: () => void;
};

export function PlanWeekBoard({ weekStart, onMutated }: Props) {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const businessFilter = activeId === ALL ? null : activeId;

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const { data: backlogAll = [] } = useQuery({
    queryKey: ["backlog", businessFilter ?? "all"],
    queryFn: () => listBacklog(businessFilter),
  });
  const { data: committedAll = [] } = useQuery({
    queryKey: ["committed", weekStart],
    queryFn: () => listCommitted(weekStart),
  });

  const businessName = useMemo(
    () => new Map(businesses.map((b) => [b.id, b.name])),
    [businesses],
  );

  // Filter committed by active account (backlog already scoped via the query key).
  const backlog = useMemo(
    () =>
      [...backlogAll].sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return (a.due_at ?? "").localeCompare(b.due_at ?? "");
      }),
    [backlogAll],
  );
  const committed = useMemo(
    () =>
      [...committedAll]
        .filter((t) => (businessFilter ? t.business_id === businessFilter : true))
        .sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 2;
          const pb = PRIORITY_ORDER[b.priority] ?? 2;
          if (pa !== pb) return pa - pb;
          return (a.due_at ?? "").localeCompare(b.due_at ?? "");
        }),
    [committedAll, businessFilter],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  function findZoneOf(id: string): Zone | null {
    if (backlog.some((t) => t.id === id)) return "backlog";
    if (committed.some((t) => t.id === id)) return "committed";
    return null;
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const t =
      backlog.find((x) => x.id === id) ?? committed.find((x) => x.id === id) ?? null;
    setActiveTask(t);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const activeId = String(e.active.id);
    const overId = e.over?.id != null ? String(e.over.id) : null;
    if (!overId) return;

    const from = findZoneOf(activeId);
    // Dropping on a container id or on a task already in the target container.
    const to: Zone | null =
      overId === "backlog" || overId === "committed"
        ? (overId as Zone)
        : findZoneOf(overId);
    if (!from || !to || from === to) return;

    const task =
      backlog.find((t) => t.id === activeId) ??
      committed.find((t) => t.id === activeId);
    if (!task) return;

    // Optimistic cache update so capacity reflects the move instantly.
    const backlogKey = ["backlog", businessFilter ?? "all"];
    const committedKey = ["committed", weekStart];
    const prevBacklog = qc.getQueryData<Task[]>(backlogKey);
    const prevCommitted = qc.getQueryData<Task[]>(committedKey);

    if (to === "committed") {
      qc.setQueryData<Task[]>(backlogKey, (old) =>
        (old ?? []).filter((t) => t.id !== activeId),
      );
      qc.setQueryData<Task[]>(committedKey, (old) => [
        ...(old ?? []),
        { ...task, committed_week: weekStart },
      ]);
    } else {
      qc.setQueryData<Task[]>(committedKey, (old) =>
        (old ?? []).filter((t) => t.id !== activeId),
      );
      qc.setQueryData<Task[]>(backlogKey, (old) => [
        ...(old ?? []),
        { ...task, committed_week: null },
      ]);
    }

    try {
      if (to === "committed") await commitTasks([activeId], weekStart);
      else await uncommitTasks([activeId]);
      onMutated?.();
      toast.success(to === "committed" ? "Committed to this week" : "Moved back to backlog");
    } catch (err) {
      // Rollback
      if (prevBacklog) qc.setQueryData(backlogKey, prevBacklog);
      if (prevCommitted) qc.setQueryData(committedKey, prevCommitted);
      toast.error(err instanceof Error ? err.message : "Couldn't move that task");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up task ${active.id}.`,
          onDragOver: ({ active, over }) =>
            over ? `Task ${active.id} is over ${over.id}.` : `Task ${active.id}.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Task ${active.id} dropped on ${over.id}.`
              : `Task ${active.id} dropped, no change.`,
          onDragCancel: ({ active }) => `Dragging cancelled for task ${active.id}.`,
        },
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Column
          zone="backlog"
          title="Backlog"
          subtitle="Uncommitted tasks"
          items={backlog}
          businessName={businessName}
          emptyText="Backlog is empty. Tasks land here until you commit them."
        />
        <Column
          zone="committed"
          title="This week's commitment"
          subtitle="Drag in to commit"
          items={committed}
          businessName={businessName}
          emptyText="Drag tasks here to commit them to this week."
        />
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard task={activeTask} businessName={activeTask.business_id ? businessName.get(activeTask.business_id) ?? null : null} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  zone,
  title,
  subtitle,
  items,
  businessName,
  emptyText,
}: {
  zone: Zone;
  title: string;
  subtitle: string;
  items: Task[];
  businessName: Map<string, string>;
  emptyText: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zone });
  const ids = items.map((t) => t.id);
  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      className={cn(
        "rounded-xl border bg-card/40 p-3 min-h-[260px] transition-colors",
        isOver && "border-primary/60 bg-primary/5",
      )}
    >
      <header className="flex items-baseline justify-between px-1 pb-2">
        <h3 className="text-sm font-medium">
          {title} <span className="text-muted-foreground tabular-nums">({items.length})</span>
        </h3>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.length === 0 ? (
          <Card className="p-6 text-center text-xs text-muted-foreground border-dashed bg-transparent">
            {emptyText}
          </Card>
        ) : (
          <ul className="space-y-1.5">
            {items.map((t) => (
              <SortableTask
                key={t.id}
                task={t}
                businessName={t.business_id ? businessName.get(t.business_id) ?? null : null}
              />
            ))}
          </ul>
        )}
      </SortableContext>
    </section>
  );
}

function SortableTask({ task, businessName }: { task: Task; businessName: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners} className="list-none">
      <TaskCard task={task} businessName={businessName} />
    </li>
  );
}

function TaskCard({
  task,
  businessName,
  dragging,
}: {
  task: Task;
  businessName: string | null;
  dragging?: boolean;
}) {
  const noEstimate = !hasEstimate(task);
  const minutes = task.estimated_minutes ?? 0;
  const est =
    minutes > 0
      ? minutes >= 60
        ? `${Math.round((minutes / 60) * 10) / 10}h`
        : `${minutes}m`
      : null;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-3 py-2 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "shadow-lg ring-2 ring-primary/40",
      )}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0" aria-hidden />
      <Flag
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: PRIORITY_COLOR[task.priority] }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm truncate", task.status === "done" && "line-through text-muted-foreground")}>
          {task.title}
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
          <span>{PRIORITY_LABEL[task.priority]}</span>
          {task.due_at && (
            <span>
              due{" "}
              {new Date(task.due_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {businessName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {businessName}
            </Badge>
          )}
          {est ? (
            <span className="tabular-nums">est {est}</span>
          ) : (
            <span
              className="flex items-center gap-0.5 text-amber-600 dark:text-amber-500"
              title="No duration estimate, counted at 1h for capacity"
            >
              <AlertCircle className="h-3 w-3" />
              no estimate
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
