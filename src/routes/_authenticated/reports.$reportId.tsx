import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getWeeklyReport, type PerBusinessMetrics } from "@/lib/weekly-reports";

export const Route = createFileRoute("/_authenticated/reports/$reportId")({
  head: () => ({ meta: [{ title: "Report · Heartbeat" }] }),
  component: ReportDetail,
});

function ReportDetail() {
  const { reportId } = Route.useParams();
  const { data: report, isLoading } = useQuery({
    queryKey: ["weekly-report", reportId],
    queryFn: () => getWeeklyReport(reportId),
  });

  if (isLoading) {
    return <div className="max-w-4xl mx-auto px-8 py-16 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!report) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-16 space-y-4">
        <p>Report not found.</p>
        <Link to="/reports"><Button variant="outline">Back</Button></Link>
      </div>
    );
  }

  const o = report.metrics?.overall;
  const per = report.metrics?.per_business ?? [];
  const n = report.narrative ?? {
    headline: "",
    wins: [],
    slipped: [],
    at_risk: [],
    suggestions: [],
  };
  const start = new Date(report.week_start);
  const end = new Date(report.week_end);
  const rate = Math.round((o?.completion_rate ?? 0) * 100);

  return (
    <div className="max-w-4xl mx-auto px-8 py-16 space-y-10">
      <div>
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All reports
        </Link>
      </div>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {start.toLocaleDateString()} – {end.toLocaleDateString()}
        </p>
        <h1 className="text-3xl text-primary leading-tight">
          {n.headline || "Weekly review"}
        </h1>
      </header>

      {o && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Completion" value={`${rate}%`} />
          <Stat label="Tasks done" value={o.tasks_completed} />
          <Stat label="Created" value={o.tasks_created} />
          <Stat label="On time" value={o.completed_on_time} />
          <Stat label="Late" value={o.completed_late} />
          <Stat label="Meetings" value={o.meetings_count} />
          <Stat label="Notes" value={o.notes_added} />
          <Stat label="Dropped balls" value={o.dropped_balls.length} />
        </div>
      )}

      {per.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Completed vs created per business
          </h2>
          <Card className="p-5 space-y-3">
            {per.map((b) => <BusinessBar key={b.business_id ?? "unassigned"} b={b} />)}
          </Card>
        </section>
      )}

      <Section title="Wins" items={n.wins} empty="No standout wins this week." />

      <SlippedSection report={report} narrativeItems={n.slipped} />

      <Section title="At risk" items={n.at_risk} empty="Nothing flagged for the week ahead." />

      <Section
        title="Suggestions"
        items={n.suggestions}
        empty="No suggestions — keep going."
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
      <div className="text-2xl font-medium">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              <span>{x}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SlippedSection({
  report,
  narrativeItems,
}: {
  report: { metrics: { overall?: PerBusinessMetrics } };
  narrativeItems: string[];
}) {
  const dropped = report.metrics?.overall?.dropped_balls ?? [];
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">What slipped</h2>
      {dropped.length === 0 && narrativeItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing major slipped.</p>
      ) : (
        <>
          {dropped.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {dropped.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    <span className="text-muted-foreground mr-2">•</span>
                    {t.title}
                    {t.priority === "urgent" || t.priority === "high" ? (
                      <span className="ml-2 text-xs uppercase tracking-wider text-muted-foreground">
                        {t.priority}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {t.days_overdue}d overdue
                  </span>
                </li>
              ))}
            </ul>
          )}
          {narrativeItems.length > 0 && (
            <ul className="space-y-1.5 text-sm pt-2">
              {narrativeItems.map((x, i) => (
                <li key={i} className="flex gap-2 text-muted-foreground">
                  <span>—</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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
