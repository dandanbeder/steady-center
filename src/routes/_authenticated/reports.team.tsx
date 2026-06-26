import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeGate } from "@/components/upgrade-gate";
import { getTeamReport, type TeamReportResult } from "@/lib/team-reports.functions";

export const Route = createFileRoute("/_authenticated/reports/team")({
  head: () => ({ meta: [{ title: "Team report · Heartbeat" }] }),
  component: () => (
    <UpgradeGate feature="team_sharing">
      <TeamReportPage />
    </UpgradeGate>
  ),
});

type Granularity = "week" | "month";
type StatusFilter = "all" | "todo" | "in_progress" | "review" | "done" | "overdue";
type Preset = "this_week" | "last_4_weeks" | "this_month" | "last_3_months" | "custom";

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Preset): { start: string; end: string; granularity: Granularity } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  if (preset === "this_week") {
    const s = new Date(end);
    const day = s.getUTCDay();
    const diff = (day + 6) % 7;
    s.setUTCDate(s.getUTCDate() - diff);
    s.setUTCHours(0, 0, 0, 0);
    return { start: toISODate(s), end: toISODate(end), granularity: "week" };
  }
  if (preset === "last_4_weeks") {
    const s = new Date(end);
    s.setUTCDate(s.getUTCDate() - 28);
    return { start: toISODate(s), end: toISODate(end), granularity: "week" };
  }
  if (preset === "this_month") {
    const s = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    return { start: toISODate(s), end: toISODate(end), granularity: "week" };
  }
  // last_3_months
  const s = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  return { start: toISODate(s), end: toISODate(end), granularity: "month" };
}

function TeamReportPage() {
  const [preset, setPreset] = useState<Preset>("last_4_weeks");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [granularityOverride, setGranularityOverride] = useState<Granularity | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [outcomeId, setOutcomeId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      return {
        start: customStart,
        end: customEnd,
        granularity: granularityOverride ?? "week",
      };
    }
    const r = presetRange(preset === "custom" ? "last_4_weeks" : preset);
    return { ...r, granularity: granularityOverride ?? r.granularity };
  }, [preset, customStart, customEnd, granularityOverride]);

  const fetchReport = useServerFn(getTeamReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["team-report", range, businessId, statusFilter, outcomeId],
    queryFn: () =>
      fetchReport({
        data: {
          businessId,
          periodStart: new Date(range.start + "T00:00:00Z").toISOString(),
          periodEnd: new Date(range.end + "T23:59:59Z").toISOString(),
          granularity: range.granularity,
          status: statusFilter === "all" ? null : statusFilter,
          outcomeId,
        },
      }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16 space-y-8">
      <header className="space-y-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Team report</p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary mt-1">
              How the team is moving together
            </h1>
            <p className="mt-2 text-muted-foreground max-w-2xl">
              A calm look at shared work, what's getting done, what's in flight, and how outcomes are
              progressing. Private notes, journals, and unshared tasks stay private.
            </p>
          </div>
          <Link to="/reports" className="text-sm text-primary hover:underline">
            ← Personal reflections
          </Link>
        </div>
      </header>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground mr-1">Period:</span>
          {(
            [
              ["this_week", "This week"],
              ["last_4_weeks", "Last 4 weeks"],
              ["this_month", "This month"],
              ["last_3_months", "Last 3 months"],
              ["custom", "Custom"],
            ] as Array<[Preset, string]>
          ).map(([p, label]) => (
            <Chip key={p} active={preset === p} onClick={() => setPreset(p)}>
              {label}
            </Chip>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="border border-border bg-background rounded-md px-2 py-1"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="border border-border bg-background rounded-md px-2 py-1"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground mr-1">View by:</span>
          <Chip
            active={(granularityOverride ?? range.granularity) === "week"}
            onClick={() => setGranularityOverride("week")}
          >
            Week
          </Chip>
          <Chip
            active={(granularityOverride ?? range.granularity) === "month"}
            onClick={() => setGranularityOverride("month")}
          >
            Month
          </Chip>
        </div>
        {data && data.scope.businesses.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground mr-1">Account:</span>
            <Chip active={businessId === null} onClick={() => setBusinessId(null)}>
              All team accounts
            </Chip>
            {data.scope.businesses.map((b) => (
              <Chip
                key={b.id}
                active={businessId === b.id}
                onClick={() => setBusinessId(b.id)}
                color={b.color}
              >
                {b.name}
              </Chip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground mr-1">Status:</span>
          {(
            [
              ["all", "All"],
              ["todo", "To do"],
              ["in_progress", "In progress"],
              ["review", "In review"],
              ["done", "Done"],
              ["overdue", "Past due"],
            ] as Array<[StatusFilter, string]>
          ).map(([s, label]) => (
            <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {label}
            </Chip>
          ))}
        </div>
        {data && data.by_outcome.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground mr-1">Outcome:</span>
            <Chip active={outcomeId === null} onClick={() => setOutcomeId(null)}>
              All
            </Chip>
            {data.by_outcome.slice(0, 6).map((o) => (
              <Chip key={o.id} active={outcomeId === o.id} onClick={() => setOutcomeId(o.id)}>
                {o.name}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Couldn't load the team report. Try again in a moment.
        </Card>
      ) : !data ? null : data.scope.businesses.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No team accounts yet. When you invite someone to an account, shared work will show here.
        </Card>
      ) : (
        <ReportBody data={data} />
      )}
    </div>
  );
}

function ReportBody({ data }: { data: TeamReportResult }) {
  const t = data.totals;
  const rate = Math.round(t.completion_rate * 100);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          How the team is doing
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Shared tasks" value={t.shared_tasks} />
          <Stat label="Closed this period" value={t.completed_in_period} />
          <Stat label="Still in flight" value={t.open} />
          <Stat label="Completion" value={`${rate}%`} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Outcomes in progress" value={t.outcomes_active} />
          <Stat label="Outcomes reached" value={t.outcomes_achieved_in_period} />
          <Stat label="Team commitments" value={t.team_commitments} />
          <Stat label="Commitments met" value={t.team_commitments_met} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">By account</h2>
        <Card className="p-5">
          {data.by_account.filter((a) => a.total > 0).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              A quieter period across the team accounts, that's okay.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.by_account
                .filter((a) => a.total > 0)
                .map((a) => (
                  <li key={a.business_id} className="py-3 flex items-center gap-3">
                    <span
                      className="inline-block size-3 rounded-full shrink-0"
                      style={{ backgroundColor: a.color || "oklch(0.78 0.04 250)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <ProgressBar value={a.completion_rate} />
                    </div>
                    <div className="flex gap-6 text-xs text-muted-foreground shrink-0 text-right">
                      <span>{a.completed} done</span>
                      <span>{a.open} in flight</span>
                      {a.overdue > 0 && <span>{a.overdue} past due</span>}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </section>

      {data.scope.can_see_member_breakdown && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Team progress (owner view)
          </h2>
          <p className="text-xs text-muted-foreground">
            A supportive look at how shared work is moving, not a ranking. Private items stay private.
          </p>
          <Card className="p-5">
            {data.by_member.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shared tasks in this period yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.by_member.map((m) => (
                  <li key={m.user_id} className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{m.full_name}</div>
                        <ProgressBar value={m.completion_rate} />
                      </div>
                      <div className="flex gap-5 text-xs text-muted-foreground shrink-0 text-right">
                        <span>{m.completed} done</span>
                        <span>{m.in_progress} in progress</span>
                        {m.overdue > 0 && <span>{m.overdue} past due</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">By outcome</h2>
        <Card className="p-5">
          {data.by_outcome.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No team outcomes in scope yet. Add an outcome to an account to track progress here.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.by_outcome.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <Link
                        to="/outcomes"
                        className="font-medium hover:underline truncate block"
                      >
                        {o.name}
                      </Link>
                      <ProgressBar value={o.progress} />
                    </div>
                    <div className="flex gap-5 text-xs text-muted-foreground shrink-0 text-right">
                      <span>
                        {o.completed_tasks}/{o.total_tasks} tasks
                      </span>
                      {o.target_date && (
                        <span>target {new Date(o.target_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Trend over time
        </h2>
        <Card className="p-5">
          <TrendChart trend={data.trend} granularity={data.scope.granularity} />
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-medium">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

function Chip({
  children,
  active,
  onClick,
  color,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs transition-colors " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-foreground hover:bg-accent/40")
      }
    >
      {color && (
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </button>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TrendChart({
  trend,
  granularity,
}: {
  trend: TeamReportResult["trend"];
  granularity: "week" | "month";
}) {
  const max = Math.max(1, ...trend.map((b) => Math.max(b.completed, b.created)));
  if (trend.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough history yet.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 h-32">
        {trend.map((b) => (
          <div key={b.bucket_start} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-end gap-0.5 h-full w-full justify-center">
              <div
                className="w-2 rounded-t bg-primary/70"
                style={{ height: `${(b.completed / max) * 100}%` }}
                title={`${b.completed} closed`}
              />
              <div
                className="w-2 rounded-t bg-muted-foreground/40"
                style={{ height: `${(b.created / max) * 100}%` }}
                title={`${b.created} added`}
              />
            </div>
            <div className="text-[10px] text-muted-foreground">
              {granularity === "week"
                ? new Date(b.bucket_start).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : new Date(b.bucket_start).toLocaleDateString(undefined, {
                    month: "short",
                  })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground justify-center">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded bg-primary/70" /> closed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded bg-muted-foreground/40" /> added
        </span>
      </div>
    </div>
  );
}
