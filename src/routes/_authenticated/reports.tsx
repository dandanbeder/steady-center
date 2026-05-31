import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listWeeklyReports, type WeeklyReport, type PerBusinessMetrics } from "@/lib/weekly-reports";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports · Heartbeat" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["weekly-reports"],
    queryFn: listWeeklyReports,
  });

  return (
    <div className="max-w-4xl mx-auto px-8 py-16 space-y-10">
      <header>
        <h1 className="text-4xl text-primary">Weekly reports</h1>
        <p className="mt-2 text-muted-foreground">
          Your week, summarized. Generated automatically on your chosen day.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reports.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No reports yet. Your first one will land on your scheduled day.
        </Card>
      ) : (
        <div className="space-y-8">
          {reports.map((r) => <ReportCard key={r.id} report={r} />)}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: WeeklyReport }) {
  const m = report.metrics;
  const o = m?.overall;
  const per = m?.per_business ?? [];
  const start = new Date(report.week_start);
  const end = new Date(report.week_end);

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-medium">
          {start.toLocaleDateString()} – {end.toLocaleDateString()}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Generated {new Date(report.created_at).toLocaleString()}
        </p>
      </div>

      {o && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Tasks done" value={o.tasks_completed} />
          <Stat label="Created" value={o.tasks_created} />
          <Stat label="On time" value={o.completed_on_time} />
          <Stat label="Late" value={o.completed_late} />
          <Stat label="Meetings" value={o.meetings_held} />
          <Stat label="Actions closed" value={o.action_items_closed} />
          <Stat label="Actions open" value={o.action_items_open} />
          <Stat label="Notes" value={o.notes_added} />
        </div>
      )}

      {per.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Completed vs created per business
          </p>
          <div className="space-y-2">
            {per.map((b) => <BusinessBar key={b.business_id ?? "unassigned"} b={b} />)}
          </div>
        </div>
      )}

      {report.narrative && (
        <div className="rounded-lg bg-muted/40 p-4 whitespace-pre-wrap text-sm leading-relaxed">
          {report.narrative}
        </div>
      )}

      {o && o.high_priority_open_or_overdue.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            High-priority still open or overdue
          </p>
          <ul className="text-sm space-y-1">
            {o.high_priority_open_or_overdue.map((t) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span className="truncate">{t.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {t.due_at ? `due ${new Date(t.due_at).toLocaleDateString()}` : "no due date"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
      <div className="text-2xl font-medium">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function BusinessBar({ b }: { b: PerBusinessMetrics }) {
  const max = Math.max(b.tasks_created, b.tasks_completed, 1);
  const createdPct = (b.tasks_created / max) * 100;
  const donePct = (b.tasks_completed / max) * 100;
  return (
    <div className="text-sm">
      <div className="flex justify-between mb-1">
        <span>{b.business_name}</span>
        <span className="text-muted-foreground">
          {b.tasks_completed}/{b.tasks_created} done
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-muted-foreground/40" style={{ width: `${createdPct}%` }} />
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${donePct}%` }} />
        </div>
      </div>
    </div>
  );
}
