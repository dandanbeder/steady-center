import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getWeeklyReport,
  type PerBusinessMetrics,
  type ReportMetrics,
  type ReportNarrative,
} from "@/lib/weekly-reports";

import { UpgradeGate } from "@/components/upgrade-gate";

export const Route = createFileRoute("/_authenticated/reports/$reportId")({
  head: () => ({ meta: [{ title: "Report · Heartbeat" }] }),
  component: () => (
    <UpgradeGate feature="weekly_reports">
      <ReportDetail />
    </UpgradeGate>
  ),
});

function ReportDetail() {
  const { reportId } = Route.useParams();
  const { data: report, isLoading } = useQuery({
    queryKey: ["weekly-report", reportId],
    queryFn: () => getWeeklyReport(reportId),
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!report) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16 space-y-4">
        <p>Report not found.</p>
        <Link to="/reports">
          <Button variant="outline">Back</Button>
        </Link>
      </div>
    );
  }

  const m = report.metrics as ReportMetrics;
  const o = m?.overall;
  const per = m?.per_business ?? [];
  const flow = m?.flow;
  const topTasks = m?.top_tasks_hours ?? [];
  const goals = m?.goals ?? [];
  const n: ReportNarrative = report.narrative ?? { headline: "" };
  const start = new Date(report.week_start);
  const end = new Date(report.week_end);
  const rate = Math.round((o?.completion_rate ?? 0) * 100);
  const onTimePct =
    o && o.tasks_completed > 0
      ? Math.round((o.completed_on_time / o.tasks_completed) * 100)
      : null;
  const hours = o?.tracked_hours ?? m?.tracked_hours_total ?? 0;

  // Backward compat: older reports only have wins/slipped/at_risk/suggestions
  const strengths = n.strengths ?? [];
  const growthAreas = n.growth_areas ?? [];
  const nextWeek = n.next_week ?? [];
  const legacyMode = strengths.length === 0 && growthAreas.length === 0 && (n.wins?.length || n.slipped?.length || n.suggestions?.length);

  const openCount = flow
    ? Object.entries(flow.counts_by_status)
        .filter(([k]) => k !== "done")
        .reduce((s, [, v]) => s + v, 0)
    : 0;
  const doneTotal = flow?.counts_by_status?.done ?? 0;
  const throughputDelta = flow
    ? flow.throughput_this_week - flow.throughput_last_week
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 space-y-10">
      <div>
        <Link
          to="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All reports
        </Link>
      </div>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {start.toLocaleDateString()} – {end.toLocaleDateString()}
        </p>
        <h1 className="text-2xl sm:text-3xl text-primary leading-tight">
          {n.headline || "Weekly review"}
        </h1>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Tracked hours" value={`${hours}h`} />
        <Stat label="Tasks completed" value={o?.tasks_completed ?? 0} />
        <Stat
          label="On-time %"
          value={onTimePct === null ? "—" : `${onTimePct}%`}
        />
        <Stat
          label="Avg cycle"
          value={flow?.avg_cycle_days != null ? `${flow.avg_cycle_days}d` : "—"}
        />
        <Stat label="Completion" value={`${rate}%`} />
      </div>

      {/* Hours per top task chart */}
      {topTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Hours per task (top {topTasks.length})
          </h2>
          <Card className="p-4">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topTasks.map((t) => ({
                    name:
                      t.title.length > 28 ? t.title.slice(0, 26) + "…" : t.title,
                    hours: t.hours,
                    business: t.business_name,
                  }))}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={180}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v}h`, "Tracked"]}
                  />
                  <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>
      )}

      {/* Completed vs waiting */}
      {flow && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Completed vs waiting
          </h2>
          <Card className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Completed (all-time)" value={doneTotal} small />
              <Stat label="Open / in progress" value={openCount} small />
              <Stat label="This week done" value={flow.throughput_this_week} small />
              <Stat
                label="vs last week"
                value={
                  (throughputDelta > 0 ? "+" : "") +
                  throughputDelta +
                  ` (was ${flow.throughput_last_week})`
                }
                small
              />
            </div>
            {flow.stuck.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Stuck / waiting &gt; 7 days
                </p>
                <ul className="divide-y divide-border text-sm">
                  {flow.stuck.map((t) => (
                    <li
                      key={t.id}
                      className="py-2 flex justify-between items-center gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{t.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.business_name} · {t.status}
                          {t.priority !== "normal" ? ` · ${t.priority}` : ""}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 text-right">
                        <div>{t.days_open}d open</div>
                        <div>{t.days_in_status}d in status</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Oldest open tasks */}
      {flow && flow.oldest_open.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Oldest open tasks (aging)
          </h2>
          <Card className="p-5">
            <ul className="divide-y divide-border text-sm">
              {flow.oldest_open.map((t) => (
                <li
                  key={t.id}
                  className="py-2 flex justify-between items-center gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.business_name} · {t.status}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {t.days_open}d
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Weekly goals */}
      {goals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Week's goals
          </h2>
          <Card className="p-5 space-y-4">
            {goals.map((g) => (
              <div key={g.id} className="space-y-1">
                <div className="flex justify-between items-baseline gap-3">
                  <div className="text-sm">
                    {g.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {g.business_name}
                    </span>
                  </div>
                  <div className="text-xs">
                    {g.target_value != null ? (
                      <span className="text-muted-foreground">
                        {g.current_value}
                        {g.metric_type === "hours" ? "h" : ""} /{" "}
                        {g.target_value}
                        {g.metric_type === "hours" ? "h" : ""}
                      </span>
                    ) : null}
                    <span
                      className={
                        "ml-2 uppercase tracking-wider " +
                        (g.status === "met"
                          ? "text-primary"
                          : g.status === "missed"
                            ? "text-destructive"
                            : "text-muted-foreground")
                      }
                    >
                      {g.status}
                    </span>
                  </div>
                </div>
                <Progress value={g.progress_pct} />
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* Per-business breakdown (kept) */}
      {per.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Per business
          </h2>
          <Card className="p-5 space-y-3">
            {per.map((b) => (
              <BusinessBar key={b.business_id ?? "unassigned"} b={b} />
            ))}
          </Card>
        </section>
      )}

      {/* Narrative: strengths / growth areas */}
      {legacyMode ? (
        <>
          <PlainSection title="Wins" items={n.wins ?? []} empty="No standout wins this week." />
          <PlainSection title="What slipped" items={n.slipped ?? []} empty="Nothing major slipped." />
          <PlainSection title="At risk" items={n.at_risk ?? []} empty="Nothing flagged for the week ahead." />
          <PlainSection title="Suggestions" items={n.suggestions ?? []} empty="No suggestions — keep going." />
        </>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Strengths</h2>
            {strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not much to celebrate yet — light week.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {strengths.map((s, i) => (
                  <li key={i} className="rounded-lg border border-border bg-card/60 p-3">
                    <div className="font-medium">{s.point}</div>
                    {s.evidence && (
                      <div className="text-muted-foreground mt-1">{s.evidence}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Growth areas</h2>
            {growthAreas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing obvious to improve this week.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {growthAreas.map((g, i) => (
                  <li key={i} className="rounded-lg border border-border bg-card/60 p-3 space-y-1">
                    <div className="font-medium">{g.point}</div>
                    {g.why && (
                      <div className="text-muted-foreground text-xs">{g.why}</div>
                    )}
                    {g.suggestion && (
                      <div className="text-primary">→ {g.suggestion}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {n.goal_review && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Goal review</h2>
              <p className="text-sm text-muted-foreground">{n.goal_review}</p>
            </section>
          )}

          {nextWeek.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Focus for next week</h2>
              <ul className="space-y-1.5 text-sm">
                {nextWeek.map((x, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: number | string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
      <div className={small ? "text-lg font-medium" : "text-2xl font-medium"}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PlainSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
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

function BusinessBar({ b }: { b: PerBusinessMetrics }) {
  const max = Math.max(b.tasks_created, b.tasks_completed, 1);
  const createdPct = (b.tasks_created / max) * 100;
  const donePct = (b.tasks_completed / max) * 100;
  return (
    <div className="text-sm">
      <div className="flex justify-between mb-1">
        <span>
          {b.business_name}
          {b.tracked_hours != null && b.tracked_hours > 0 ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {b.tracked_hours}h
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground">
          {b.tasks_completed}/{b.tasks_created} done
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-muted-foreground/40"
            style={{ width: `${createdPct}%` }}
          />
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${donePct}%` }} />
        </div>
      </div>
    </div>
  );
}
