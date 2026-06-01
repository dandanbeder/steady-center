import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, Calendar as CalIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { listBusinesses } from "@/lib/businesses";
import {
  listMyWeekTasks,
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  updateTask,
  type Task,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { WeeklyGoalsPanel } from "@/components/weekly-goals-panel";

export const Route = createFileRoute("/_authenticated/my-week")({
  head: () => ({ meta: [{ title: "My Week · Heartbeat" }] }),
  component: MyWeekPage,
});

function MyWeekPage() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({
    queryKey: ["my-week"],
    queryFn: listMyWeekTasks,
  });
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const now = new Date();

  const sorted = [...tasks].sort((a, b) => {
    const aOverdue = a.due_at && new Date(a.due_at) < now ? 0 : 1;
    const bOverdue = b.due_at && new Date(b.due_at) < now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return (a.due_at ? +new Date(a.due_at) : 0) - (b.due_at ? +new Date(b.due_at) : 0);
  });

  const overdue = sorted.filter((t) => t.due_at && new Date(t.due_at) < now);
  const upcoming = sorted.filter((t) => !overdue.includes(t));

  const toggle = useMutation({
    mutationFn: (t: Task) => updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-week"] }),
  });

  const businessById = new Map(businesses.map((b) => [b.id, b]));

  return (
    <div className="max-w-3xl mx-auto px-8 py-16">
      <h1 className="text-4xl text-primary">My Week</h1>
      <p className="mt-2 text-muted-foreground">
        Everything due in the next 7 days, across every business.
      </p>

      <div className="mt-6">
        <WeeklyGoalsPanel compact />
      </div>



      {overdue.length > 0 && (
        <Section title="Overdue" tone="destructive">
          {overdue.map((t) => (
            <Row
              key={t.id}
              task={t}
              business={t.business_id ? businessById.get(t.business_id) : undefined}
              onToggle={() => toggle.mutate(t)}
              overdue
            />
          ))}
        </Section>
      )}

      <Section title={overdue.length ? "Coming up" : "This week"}>
        {upcoming.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Clean slate. Nothing due in the next week.</p>
        ) : (
          upcoming.map((t) => (
            <Row
              key={t.id}
              task={t}
              business={t.business_id ? businessById.get(t.business_id) : undefined}
              onToggle={() => toggle.mutate(t)}
            />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className={cn(
        "text-xs uppercase tracking-wider mb-2",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
      )}>{title}</h2>
      <div
        className="rounded-2xl border border-border bg-card divide-y divide-border"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        {children}
      </div>
    </section>
  );
}

function Row({
  task,
  business,
  onToggle,
  overdue,
}: {
  task: Task;
  business?: { name: string; color: string };
  onToggle: () => void;
  overdue?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Checkbox checked={task.status === "done"} onCheckedChange={onToggle} />
      <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm truncate", task.status === "done" && "line-through text-muted-foreground")}>
          {task.title}
        </div>
        {business && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: business.color }} />
            {business.name}
          </div>
        )}
      </div>
      {task.due_at && (
        <span className={cn("text-xs flex items-center gap-1 shrink-0", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
          <CalIcon className="h-3 w-3" />
          {new Date(task.due_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
