import { useMemo } from "react";
import type { Task } from "@/lib/tasks";
import { PRIORITY_COLOR } from "@/lib/tasks";
import { cn } from "@/lib/utils";

type Outcome = { id: string; name: string; target_date: string | null };

export function TimelineView({
  tasks,
  onOpen,
  outcomes = [],
}: {
  tasks: Task[];
  onOpen: (t: Task) => void;
  outcomes?: Outcome[];
}) {
  const dated = useMemo(() => tasks.filter((t) => !!t.due_at), [tasks]);

  const { start, end, days } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let min = +now;
    let max = +now + 30 * 86400000;
    for (const t of dated) {
      const d = +new Date(t.due_at!);
      if (d < min) min = d;
      if (d > max) max = d;
      const created = +new Date(t.created_at);
      if (created < min) min = created;
    }
    for (const o of outcomes) {
      if (!o.target_date) continue;
      const d = +new Date(`${o.target_date}T23:59:59`);
      if (d < min) min = d;
      if (d > max) max = d;
    }
    const startD = new Date(min);
    startD.setHours(0, 0, 0, 0);
    const endD = new Date(max);
    endD.setHours(23, 59, 59, 999);
    const days = Math.max(7, Math.ceil((+endD - +startD) / 86400000) + 1);
    return { start: +startD, end: +endD, days };
  }, [dated, outcomes]);

  if (dated.length === 0 && outcomes.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
        Timeline needs tasks with due dates. Add one to see it here.
      </div>
    );
  }

  const total = end - start || 1;
  const pct = (t: number) => ((t - start) / total) * 100;

  // Month tick marks
  const ticks: { label: string; left: number }[] = [];
  {
    const d = new Date(start);
    d.setDate(1);
    while (+d <= end) {
      ticks.push({
        label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        left: pct(+d),
      });
      d.setMonth(d.getMonth() + 1);
    }
  }

  const todayLeft = pct(Date.now());

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="relative h-7 border-b border-border bg-muted/40 text-[10px] text-muted-foreground">
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/60 pl-1 flex items-center"
            style={{ left: `${t.left}%` }}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="relative">
        {/* today line */}
        {todayLeft >= 0 && todayLeft <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-primary/60 z-10 pointer-events-none"
            style={{ left: `${todayLeft}%` }}
            title="Today"
          />
        )}

        {/* Outcome milestones */}
        {outcomes
          .filter((o) => o.target_date)
          .map((o) => {
            const left = pct(+new Date(`${o.target_date}T23:59:59`));
            if (left < 0 || left > 100) return null;
            return (
              <div
                key={`m-${o.id}`}
                className="absolute top-0 bottom-0 z-10 pointer-events-none flex items-start"
                style={{ left: `${left}%` }}
              >
                <div className="-translate-x-1/2 mt-1 px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-[10px] shadow-sm whitespace-nowrap">
                  ◆ {o.name}
                </div>
              </div>
            );
          })}

        {/* rows */}
        <div className="py-2" style={{ minHeight: Math.max(120, dated.length * 28) }}>
          {dated.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-6">
              No dated tasks in range, milestones shown above.
            </div>
          )}
          {dated.map((t, i) => {
            const due = +new Date(t.due_at!);
            const created = Math.max(+new Date(t.created_at), start);
            const barStart = Math.max(created, start);
            const barEnd = Math.min(due, end);
            const left = pct(barStart);
            const width = Math.max(0.8, pct(barEnd) - pct(barStart));
            const overdue = due < Date.now() && t.status !== "done";
            return (
              <div
                key={t.id}
                className="relative h-6"
                style={{ marginTop: i === 0 ? 0 : 2 }}
              >
                <button
                  onClick={() => onOpen(t)}
                  className={cn(
                    "absolute top-0.5 h-5 rounded-sm text-[11px] px-1.5 text-white truncate text-left shadow-sm hover:brightness-110 transition",
                    t.status === "done" && "opacity-60 line-through",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: overdue ? "#dc2626" : PRIORITY_COLOR[t.priority],
                  }}
                  title={`${t.title}, due ${new Date(due).toLocaleDateString()}`}
                >
                  {t.title}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
