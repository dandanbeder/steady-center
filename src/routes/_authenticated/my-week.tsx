import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type DragEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Flag, Calendar as CalIcon, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listBusinesses } from "@/lib/businesses";
import {
  listTasksInRange,
  listLists,
  listFolders,
  createTask,
  updateTask,
  PRIORITY_COLOR,
  type Task,
} from "@/lib/tasks";
import { listEvents, type EventRow } from "@/lib/calendars";
import { getWorkingHours } from "@/lib/user-prefs";
import { WeeklyGoalsPanel } from "@/components/weekly-goals-panel";
import { WeekPulse } from "@/components/week-pulse";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-week")({
  head: () => ({ meta: [{ title: "My Week · Heartbeat" }] }),
  component: MyWeekPage,
});

const DEFAULT_TASK_HOURS = 1; // each task counts as ~1h of load if not time-blocked
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday 00:00 (local) for the week containing `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Mon
  d.setDate(d.getDate() - dow);
  return d;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtDayHeader(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventHours(e: EventRow): number {
  if (e.all_day) return 0;
  const ms = +new Date(e.end_at) - +new Date(e.start_at);
  return Math.max(0, ms / 3_600_000);
}

function MyWeekPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { activeId } = useActiveBusiness();
  const [anchor, setAnchor] = useState<Date>(() => new Date());

  const weekStart = useMemo(() => mondayOf(anchor), [anchor]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  const weekKey = weekStart.toISOString();

  const { data: tasks = [] } = useQuery({
    queryKey: ["my-week-tasks", weekKey],
    queryFn: () => listTasksInRange(weekStart, weekEnd),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["my-week-events", weekKey],
    queryFn: () => listEvents(weekStart, weekEnd),
  });
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: hours } = useQuery({
    queryKey: ["working-hours"],
    queryFn: getWorkingHours,
  });

  const dailyCap = hours?.daily_capacity_hours ?? 6;
  const workDays = hours?.work_days ?? [1, 2, 3, 4, 5];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const businessById = useMemo(
    () => new Map(businesses.map((b) => [b.id, b])),
    [businesses],
  );

  // Apply active business filter
  const filterByActive = <T extends { business_id: string | null }>(rows: T[]) =>
    activeId === ALL ? rows : rows.filter((r) => r.business_id === activeId);

  const visibleTasks = useMemo(() => filterByActive(tasks), [tasks, activeId]);
  const visibleEvents = useMemo(() => filterByActive(events), [events, activeId]);

  // Build the 7 days
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Group items per day
  const byDay = useMemo(() => {
    return days.map((d) => {
      const dayTasks = visibleTasks.filter(
        (t) => t.due_at && sameDay(new Date(t.due_at), d),
      );
      const dayEvents = visibleEvents.filter((e) =>
        sameDay(new Date(e.start_at), d),
      );
      const loadH =
        dayEvents.reduce((s, e) => s + eventHours(e), 0) +
        dayTasks.filter((t) => t.status !== "done").length * DEFAULT_TASK_HOURS;
      return { date: d, tasks: dayTasks, events: dayEvents, loadH };
    });
  }, [days, visibleTasks, visibleEvents]);

  // Mutations
  const moveTask = useMutation({
    mutationFn: ({ taskId, target }: { taskId: string; target: Date }) => {
      const existing = tasks.find((t) => t.id === taskId);
      const newDue = new Date(target);
      // Preserve existing time-of-day when possible; else 9am.
      if (existing?.due_at) {
        const prev = new Date(existing.due_at);
        newDue.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      } else {
        newDue.setHours(9, 0, 0, 0);
      }
      return updateTask(taskId, { due_at: newDue.toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-week-tasks", weekKey] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to move"),
  });

  const toggleTask = useMutation({
    mutationFn: (t: Task) =>
      updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-week-tasks", weekKey] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update task"),
  });

  // Quick-add: pick a sensible default list for the active business
  const defaultListId = useMemo(() => {
    if (lists.length === 0) return null;
    if (activeId === ALL) return lists[0].id;
    const bizFolderIds = new Set(
      folders.filter((f) => f.business_id === activeId).map((f) => f.id),
    );
    const match = lists.find((l) => bizFolderIds.has(l.folder_id));
    return match?.id ?? lists[0].id;
  }, [lists, folders, activeId]);

  const [quickAdd, setQuickAdd] = useState("");
  const [quickDay, setQuickDay] = useState<string>("0"); // index into days

  const createQuick = useMutation({
    mutationFn: () => {
      if (!defaultListId) throw new Error("Create a task list first.");
      const idx = Number(quickDay);
      const day = new Date(days[idx]);
      day.setHours(9, 0, 0, 0);
      const bizId =
        activeId === ALL
          ? folders.find((f) => lists.find((l) => l.id === defaultListId)?.folder_id === f.id)
              ?.business_id ?? null
          : activeId;
      return createTask({
        list_id: defaultListId,
        business_id: bizId,
        title: quickAdd.trim(),
        due_at: day.toISOString(),
      });
    },
    onSuccess: () => {
      setQuickAdd("");
      qc.invalidateQueries({ queryKey: ["my-week-tasks", weekKey] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const today = new Date();
  const isThisWeek = sameDay(weekStart, mondayOf(today));

  const shift = (deltaWeeks: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7 * deltaWeeks);
    setAnchor(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary">My Week</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {weekStart.toLocaleDateString(undefined, { month: "long", day: "numeric" })} –{" "}
            {new Date(weekEnd.getTime() - 1).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            <span className="mx-2 opacity-50">·</span>
            <span title="Your timezone">{tz}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shift(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isThisWeek ? "secondary" : "default"}
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            This week
          </Button>
          <Button variant="outline" size="sm" onClick={() => shift(1)} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Goals */}
      <div className="mt-6">
        <WeeklyGoalsPanel compact />
      </div>

      {/* Quick-add */}
      <div
        className="mt-6 rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        <button
          type="button"
          onClick={() => {
            if (!defaultListId) navigate({ to: "/tasks" });
          }}
          className="ml-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label={defaultListId ? "Add task" : "Go to Tasks to create a list"}
          title={defaultListId ? "Add task" : "Go to Tasks to create a list"}
        >
          <Plus className="h-4 w-4" />
        </button>
        <Input
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && quickAdd.trim() && defaultListId) createQuick.mutate();
          }}
          onClick={() => {
            if (!defaultListId) navigate({ to: "/tasks" });
          }}
          readOnly={!defaultListId}
          placeholder={defaultListId ? "Quick-add a task…" : "Create a task list first in Tasks →"}
          className="flex-1 min-w-[200px] border-0 shadow-none focus-visible:ring-0 cursor-text data-[readonly=true]:cursor-pointer"
          data-readonly={!defaultListId}
        />
        <Select value={quickDay} onValueChange={setQuickDay}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {days.map((d, i) => (
              <SelectItem key={i} value={String(i)}>
                {DAY_NAMES[i]} {d.getDate()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => {
            if (!defaultListId) {
              navigate({ to: "/tasks" });
              return;
            }
            createQuick.mutate();
          }}
          disabled={defaultListId ? !quickAdd.trim() || createQuick.isPending : false}
        >
          {defaultListId ? "Add" : "Set up Tasks"}
        </Button>
      </div>

      {/* Week pulse — a quiet heartbeat strip of the week's load */}
      <section className="mt-6 rounded-xl border border-border bg-card/40 px-4 pt-3 pb-2" style={{ boxShadow: "var(--shadow-soft)" }}>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Week pulse</h2>
          <span className="text-[10px] text-muted-foreground/70">tap a day</span>
        </div>
        <WeekPulse
          anchor={weekStart}
          onDayClick={(d) => {
            const idx = Math.round((+d - +weekStart) / 86_400_000);
            const el = document.getElementById(`my-week-day-${idx}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </section>

      {/* Week grid — 7 cols on lg, stacks on mobile */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        {byDay.map((day, i) => {
          const isToday = sameDay(day.date, today);
          const isWorkDay = workDays.includes(day.date.getDay());
          const capacity = isWorkDay ? dailyCap : Math.max(dailyCap * 0.25, 1);
          const pct = Math.min(100, Math.round((day.loadH / capacity) * 100));
          const over = day.loadH > capacity;
          return (
            <div key={i} id={`my-week-day-${i}`} className="scroll-mt-20">
              <DayColumn
                date={day.date}
                dayName={DAY_NAMES[i]}
                isToday={isToday}
                isWorkDay={isWorkDay}
                tasks={day.tasks}
                events={day.events}
                loadH={day.loadH}
                capacity={capacity}
                loadPct={pct}
                overloaded={over}
                businessById={businessById}
                onDropTask={(taskId) => moveTask.mutate({ taskId, target: day.date })}
                onToggleTask={(t) => toggleTask.mutate(t)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayColumn({
  date,
  dayName,
  isToday,
  isWorkDay,
  tasks,
  events,
  loadH,
  capacity,
  loadPct,
  overloaded,
  businessById,
  onDropTask,
  onToggleTask,
}: {
  date: Date;
  dayName: string;
  isToday: boolean;
  isWorkDay: boolean;
  tasks: Task[];
  events: EventRow[];
  loadH: number;
  capacity: number;
  loadPct: number;
  overloaded: boolean;
  businessById: Map<string, { name: string; color: string }>;
  onDropTask: (taskId: string) => void;
  onToggleTask: (t: Task) => void;
}) {
  const [over, setOver] = useState(false);

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-task-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!over) setOver(true);
    }
  };
  const onDragLeave = () => setOver(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData("application/x-task-id");
    if (id) onDropTask(id);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-xl border bg-card flex flex-col min-h-[280px] transition-colors",
        isToday ? "border-accent ring-1 ring-accent/40" : "border-border",
        over && "border-accent bg-accent/5",
        !isWorkDay && "bg-muted/30",
      )}
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-baseline justify-between">
          <div>
            <div
              className={cn(
                "text-xs uppercase tracking-wider",
                isToday ? "text-accent font-semibold" : "text-muted-foreground",
              )}
            >
              {dayName}
            </div>
            <div className="text-sm font-medium">{fmtDayHeader(date)}</div>
          </div>
          <div
            className={cn(
              "text-[11px] flex items-center gap-1 tabular-nums",
              overloaded ? "text-destructive" : "text-muted-foreground",
            )}
            title={`${loadH.toFixed(1)}h of ${capacity.toFixed(1)}h capacity`}
          >
            <Clock className="h-3 w-3" />
            {loadH.toFixed(1)}/{capacity.toFixed(0)}h
          </div>
        </div>
        <Progress
          value={Math.min(100, loadPct)}
          className={cn("h-1 mt-2", overloaded && "[&>div]:bg-destructive")}
        />
      </div>

      <div className="flex-1 p-2 space-y-1.5 overflow-hidden">
        {events.length === 0 && tasks.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center mt-6">
            Drop a task here
          </p>
        )}

        {events.map((e) => {
          const biz = e.business_id ? businessById.get(e.business_id) : undefined;
          return (
            <div
              key={e.id}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px]"
              style={biz ? { borderLeftColor: biz.color, borderLeftWidth: 3 } : undefined}
              title={e.title}
            >
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <CalIcon className="h-3 w-3" />
                {e.all_day ? "All day" : fmtTime(e.start_at)}
              </div>
              <div className="truncate font-medium">{e.title}</div>
            </div>
          );
        })}

        {tasks.map((t) => {
          const biz = t.business_id ? businessById.get(t.business_id) : undefined;
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-task-id", t.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className={cn(
                "rounded-md border border-border bg-background px-2 py-1.5 text-[12px] cursor-grab active:cursor-grabbing",
                t.status === "done" && "opacity-60",
              )}
              style={biz ? { borderLeftColor: biz.color, borderLeftWidth: 3 } : undefined}
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={t.status === "done"}
                  onCheckedChange={() => onToggleTask(t)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "truncate",
                      t.status === "done" && "line-through text-muted-foreground",
                    )}
                  >
                    {t.title}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                    <Flag className="h-2.5 w-2.5" style={{ color: PRIORITY_COLOR[t.priority] }} />
                    {t.due_at && <span>{fmtTime(t.due_at)}</span>}
                    {biz && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
                        {biz.name}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
