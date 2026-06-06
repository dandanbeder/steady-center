import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Calendar as CalIcon, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER, type Task } from "@/lib/tasks";
import { listBacklog, commitTasks, mondayOf, addWeeks } from "@/lib/weekly-plan";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  /** Show the active-business toggle + scope (defaults true). */
  scoped?: boolean;
  /** If provided, this Monday is used as "this week"; defaults to current Monday. */
  weekStart?: string;
  /** Compact mode hides the empty-state copy and tightens row padding. */
  compact?: boolean;
};

export function BacklogPanel({ scoped = true, weekStart, compact = false }: Props) {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const businessFilter = scoped && activeId !== ALL ? activeId : null;
  const thisMonday = weekStart ?? mondayOf();
  const nextMonday = addWeeks(thisMonday, 1);

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["backlog", businessFilter ?? "all"],
    queryFn: () => listBacklog(businessFilter),
  });

  const businessName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of businesses) m.set(b.id, b.name);
    return m;
  }, [businesses]);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
  }, [tasks]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const clear = () => setSelected(new Set());

  const commit = async (week: string, label: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await commitTasks(ids, week);
      clear();
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["committed"] });
      qc.invalidateQueries({ queryKey: ["my-week-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks", "today-top"] });
      toast.success(`${ids.length} task${ids.length === 1 ? "" : "s"} committed to ${label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading backlog…</p>;
  }

  if (sorted.length === 0) {
    return compact ? null : (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Your backlog is empty. Anything you create lands here until you commit it to a week.
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y border rounded-xl bg-card overflow-hidden">
        {sorted.map((t) => (
          <BacklogRow
            key={t.id}
            task={t}
            checked={selected.has(t.id)}
            onToggle={() => toggle(t.id)}
            businessName={t.business_id ? businessName.get(t.business_id) ?? null : null}
            thisMonday={thisMonday}
            compact={compact}
          />
        ))}
      </ul>

      {selected.size > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-xl border bg-card p-2 shadow-lg">
          <span className="text-sm text-muted-foreground px-2">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={clear}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={() => commit(nextMonday, "next week")}>
            Commit to next week
          </Button>
          <Button size="sm" onClick={() => commit(thisMonday, "this week")}>
            Commit to this week
          </Button>
        </div>
      )}
    </div>
  );
}

function BacklogRow({
  task,
  checked,
  onToggle,
  businessName,
  thisMonday,
  compact,
}: {
  task: Task;
  checked: boolean;
  onToggle: () => void;
  businessName: string | null;
  thisMonday: string;
  compact: boolean;
}) {
  const isRolledOver = !!task.committed_week && task.committed_week < thisMonday;
  const overdue = !!task.due_at && new Date(task.due_at) < new Date();

  return (
    <li className={cn("flex items-center gap-3", compact ? "px-3 py-2" : "px-4 py-3")}>
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label="Select task" />
      <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{task.title}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
          <span>{PRIORITY_LABEL[task.priority]}</span>
          {task.due_at && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive font-medium")}>
              <CalIcon className="h-3 w-3" />
              {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          {businessName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{businessName}</Badge>
          )}
          {isRolledOver && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
              <RotateCcw className="h-3 w-3" />
              rolled over {formatDistanceToNow(new Date(task.committed_week + "T00:00:00Z"), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
