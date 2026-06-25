import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BrainCircuit,
  Clock,
  Flag,
  RotateCcw,
  Sparkles,
  X,
  ArrowRight,
  CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { BacklogPanel } from "@/components/backlog-panel";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { useSubscription } from "@/hooks/use-subscription";
import { listBusinesses } from "@/lib/businesses";
import { listEvents } from "@/lib/calendars";
import { getWorkingHours } from "@/lib/user-prefs";
import { PRIORITY_COLOR, PRIORITY_LABEL, type Task } from "@/lib/tasks";
import {
  mondayOf,
  addWeeks,
  listCommitted,
  listRolledOver,
  commitTasks,
  uncommitTasks,
  getVelocity,
  eventHours,
  DEFAULT_TASK_HOURS,
} from "@/lib/weekly-plan";
import { suggestDeferrals, realisticPlanReview } from "@/lib/weekly-plan.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/plan-week")({
  head: () => ({
    meta: [
      { title: "Plan my week · Heartbeat" },
      { name: "description", content: "Build this week's commitment from your backlog with a live capacity check." },
    ],
  }),
  loader: ({ context }) => {
    // Prime the week's committed + rolled-over lists so the page renders instantly.
    const monday = mondayOf();
    context.queryClient.prefetchQuery({ queryKey: ["committed", monday], queryFn: () => listCommitted(monday) });
    context.queryClient.prefetchQuery({ queryKey: ["rolled-over", monday], queryFn: () => listRolledOver(monday) });
  },
  component: PlanWeekPage,
});

function PlanWeekPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const { tier } = useSubscription();
  const isPro = tier === "pro" || tier === "team";

  const thisMonday = mondayOf();
  const weekEndDate = useMemo(() => {
    const d = new Date(thisMonday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }, [thisMonday]);
  const weekStartDate = useMemo(() => new Date(thisMonday + "T00:00:00Z"), [thisMonday]);

  const { data: committed = [] } = useQuery({
    queryKey: ["committed", thisMonday],
    queryFn: () => listCommitted(thisMonday),
  });
  const { data: rolled = [] } = useQuery({
    queryKey: ["rolled-over", thisMonday],
    queryFn: () => listRolledOver(thisMonday),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["my-week-events", weekStartDate.toISOString()],
    queryFn: () => listEvents(weekStartDate, weekEndDate),
  });
  const { data: hours } = useQuery({ queryKey: ["working-hours"], queryFn: getWorkingHours });
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: velocity } = useQuery({ queryKey: ["velocity"], queryFn: getVelocity });

  const businessName = useMemo(() => new Map(businesses.map((b) => [b.id, b.name])), [businesses]);
  const filterByActive = <T extends { business_id: string | null }>(rows: T[]) =>
    activeId === ALL ? rows : rows.filter((r) => r.business_id === activeId);

  const committedFiltered = useMemo(() => filterByActive(committed), [committed, activeId]);
  const rolledFiltered = useMemo(() => filterByActive(rolled), [rolled, activeId]);
  const eventsFiltered = useMemo(() => filterByActive(events), [events, activeId]);

  // Capacity — per-account weekly budgets are the source of truth.
  const dailyCap = hours?.daily_capacity_hours ?? 6;
  const workDays = hours?.work_days ?? [1, 2, 3, 4, 5];
  const generalBudget = hours?.general_weekly_hours ?? null;

  // Per-account breakdown: { id, name, color, budget, committed }
  type AcctRow = {
    id: string | null;
    name: string;
    color: string | null;
    budget: number | null;
    committed: number;
  };
  const acctRows: AcctRow[] = useMemo(() => {
    const rows: AcctRow[] = businesses
      .filter((b) => activeId === ALL || b.id === activeId)
      .map((b) => ({
        id: b.id,
        name: b.name,
        color: b.color,
        budget: b.weekly_hours == null ? null : Number(b.weekly_hours),
        committed: 0,
      }));
    // Personal / unassigned bucket — included when viewing All or filter is null.
    if (activeId === ALL || activeId === null) {
      rows.push({
        id: null,
        name: "Personal / Uncategorised",
        color: null,
        budget: generalBudget,
        committed: 0,
      });
    }
    const byId = new Map<string | null, AcctRow>(rows.map((r) => [r.id, r]));
    for (const e of eventsFiltered) {
      const r = byId.get(e.business_id);
      if (r) r.committed += eventHours(e);
    }
    for (const t of committedFiltered) {
      if (t.status === "done") continue;
      const r = byId.get(t.business_id);
      if (r) r.committed += DEFAULT_TASK_HOURS;
    }
    return rows;
  }, [businesses, eventsFiltered, committedFiltered, activeId, generalBudget]);

  const budgetedRows = acctRows.filter((r) => r.budget != null && r.budget > 0);
  const weeklyCapacity = budgetedRows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const eventLoad = eventsFiltered.reduce((s, e) => s + eventHours(e), 0);
  const taskLoad =
    committedFiltered.filter((t) => t.status !== "done").length * DEFAULT_TASK_HOURS;
  const totalLoad = eventLoad + taskLoad;
  // Fallback to working-hours-derived capacity only when no per-account budgets are set.
  const fallbackCapacity = workDays.length * dailyCap;
  const effectiveCapacity = weeklyCapacity > 0 ? weeklyCapacity : fallbackCapacity;
  const loadPct = effectiveCapacity > 0 ? Math.round((totalLoad / effectiveCapacity) * 100) : 0;
  const loadColor =
    loadPct > 100 ? "text-destructive" : loadPct >= 80 ? "text-amber-600" : "text-muted-foreground";

  // Velocity comparison
  const committedCount = committedFiltered.filter((t) => t.status !== "done").length;
  const overPace =
    velocity && velocity.tasks_per_week > 0 && committedCount > Math.round(velocity.tasks_per_week * 1.2);

  // Mutations
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["committed"] });
    qc.invalidateQueries({ queryKey: ["rolled-over"] });
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["my-week-tasks"] });
    qc.invalidateQueries({ queryKey: ["tasks", "today-top"] });
  };

  const keepRolled = useMutation({
    mutationFn: (ids: string[]) => commitTasks(ids, thisMonday),
    onSuccess: () => { invalidateAll(); toast.success("Kept for this week"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const dropRolled = useMutation({
    mutationFn: (ids: string[]) => uncommitTasks(ids),
    onSuccess: () => { invalidateAll(); toast.success("Sent to backlog"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeFromWeek = useMutation({
    mutationFn: (id: string) => uncommitTasks([id]),
    onSuccess: invalidateAll,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // AI deferral suggestions
  const suggestFn = useServerFn(suggestDeferrals);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [suggestReason, setSuggestReason] = useState<string>("");
  const suggest = useMutation({
    mutationFn: () =>
      suggestFn({
        data: {
          week_start: thisMonday,
          business_id: activeId === ALL ? null : activeId,
        },
      }),
    onSuccess: (res) => {
      setSuggestedIds(res.defer_task_ids);
      setSuggestReason(res.reason);
      if (res.defer_task_ids.length === 0) toast.success("Nothing obvious to defer");
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Failed";
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error("Pro plan required for AI suggestions");
      } else {
        toast.error(msg);
      }
    },
  });

  // Realistic plan review (invoked AI, editable preview)
  const realisticFn = useServerFn(realisticPlanReview);
  type Suggestion = { task_id: string; action: "keep" | "defer"; reason: string };
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<string>("");
  const [reviewRealisticHours, setReviewRealisticHours] = useState<number>(0);
  const [reviewSuggestions, setReviewSuggestions] = useState<Suggestion[]>([]);
  const [acceptedDefers, setAcceptedDefers] = useState<Set<string>>(new Set());

  const review = useMutation({
    mutationFn: () =>
      realisticFn({
        data: {
          week_start: thisMonday,
          business_id: activeId === ALL ? null : activeId,
          capacity_hours: Math.round(effectiveCapacity * 10) / 10,
          committed_hours: Math.round(totalLoad * 10) / 10,
          hours_per_task: velocity?.hours_per_task ?? 0,
        },
      }),
    onSuccess: (res) => {
      setReviewSummary(res.summary);
      setReviewRealisticHours(res.realistic_hours);
      setReviewSuggestions(res.suggestions);
      setAcceptedDefers(new Set(res.suggestions.map((s) => s.task_id)));
      setReviewOpen(true);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Couldn't generate a read — try again in a moment.";
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error("Pro plan required for AI suggestions");
      } else if (msg.toLowerCase().includes("credit")) {
        toast.error("Out of AI credits — your plan still stands as it is.");
      } else {
        toast.error("Couldn't generate a read — try again in a moment.");
      }
    },
  });

  const confirmReview = useMutation({
    mutationFn: async () => {
      const ids = [...acceptedDefers];
      if (ids.length > 0) await uncommitTasks(ids);
      return ids.length;
    },
    onSuccess: (n) => {
      setReviewOpen(false);
      setReviewSuggestions([]);
      setAcceptedDefers(new Set());
      invalidateAll();
      if (n > 0) toast.success(`Moved ${n} task${n === 1 ? "" : "s"} back to the backlog`);
      else toast.success("Plan kept as is");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });



  const deferOne = useMutation({
    mutationFn: (id: string) => uncommitTasks([id]),
    onSuccess: (_d, id) => {
      setSuggestedIds((s) => s.filter((x) => x !== id));
      invalidateAll();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Rolled-over selection
  const [rolledSelected, setRolledSelected] = useState<Set<string>>(new Set());
  const toggleRolled = (id: string) =>
    setRolledSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5" />
            Plan my week
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl text-primary">
            Week of {weekStartDate.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pull tasks from the backlog into this week. Roll-overs are at the top.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/my-week">
            <CalendarRange className="h-4 w-4 mr-2" />
            Open My Week
          </Link>
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-8 min-w-0">
          {/* Rolled over */}
          {rolledFiltered.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-amber-600" />
                  <h2 className="text-sm font-medium">
                    Rolled over from last week ({rolledFiltered.length})
                  </h2>
                </div>
                {rolledSelected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { dropRolled.mutate([...rolledSelected]); setRolledSelected(new Set()); }}>
                      Send to backlog
                    </Button>
                    <Button size="sm" onClick={() => { keepRolled.mutate([...rolledSelected]); setRolledSelected(new Set()); }}>
                      Keep for this week
                    </Button>
                  </div>
                )}
              </div>
              <ul className="divide-y border rounded-xl bg-card overflow-hidden">
                {rolledFiltered.map((t) => (
                  <RolledRow
                    key={t.id}
                    task={t}
                    checked={rolledSelected.has(t.id)}
                    onToggle={() => toggleRolled(t.id)}
                    businessName={t.business_id ? businessName.get(t.business_id) ?? null : null}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Backlog */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Backlog</h2>
            <BacklogPanel scoped weekStart={thisMonday} />
          </section>

          {/* Committed */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">This week's commitment ({committedFiltered.length})</h2>
              {suggestedIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => { setSuggestedIds([]); setSuggestReason(""); }}>
                  Clear suggestions
                </Button>
              )}
            </div>
            {suggestReason && (
              <Card className="p-3 border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20">
                <p className="text-sm flex items-start gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{suggestReason}</span>
                </p>
              </Card>
            )}
            {committedFiltered.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Nothing committed yet. Pick from the backlog above.
              </Card>
            ) : (
              <ul className="divide-y border rounded-xl bg-card overflow-hidden">
                {committedFiltered.map((t) => (
                  <CommittedRow
                    key={t.id}
                    task={t}
                    businessName={t.business_id ? businessName.get(t.business_id) ?? null : null}
                    suggested={suggestedIds.includes(t.id)}
                    onRemove={() => removeFromWeek.mutate(t.id)}
                    onDefer={() => deferOne.mutate(t.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sticky rail */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Capacity</h3>
              <span className={cn("text-xs tabular-nums flex items-center gap-1", loadColor)}>
                <Clock className="h-3 w-3" />
                {totalLoad.toFixed(1)} / {effectiveCapacity.toFixed(0)}h
              </span>
            </div>
            <Progress
              value={Math.min(100, loadPct)}
              className={cn(loadPct > 100 && "[&>div]:bg-destructive", loadPct >= 80 && loadPct <= 100 && "[&>div]:bg-amber-500")}
            />
            {loadPct > 100 && (
              <p className="text-[11px] text-muted-foreground">
                You've planned more than your hours this week — gently flagged, nothing blocked.
              </p>
            )}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Calendar events: {eventLoad.toFixed(1)}h</div>
              <div>Committed tasks ({committedCount}): {taskLoad.toFixed(1)}h</div>
              {weeklyCapacity > 0 ? (
                <div>Free this week: {Math.max(0, effectiveCapacity - totalLoad).toFixed(1)}h of {effectiveCapacity.toFixed(0)}h budgeted</div>
              ) : (
                <div>Working capacity (fallback): {workDays.length} days × {dailyCap}h. Set a weekly budget per account in Settings → Accounts.</div>
              )}
            </div>

            {/* Per-account breakdown */}
            {acctRows.length > 0 && (
              <div className="pt-2 border-t border-border/60 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  By account
                </div>
                {acctRows.map((r) => {
                  const budget = r.budget ?? 0;
                  const hasBudget = r.budget != null && r.budget > 0;
                  const committed = Math.round(r.committed * 10) / 10;
                  const left = Math.max(0, budget - committed);
                  const pct = hasBudget ? Math.min(100, Math.round((committed / budget) * 100)) : 0;
                  const over = hasBudget && committed > budget;
                  return (
                    <div key={r.id ?? "personal"} className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs">
                        {r.color ? (
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        ) : (
                          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40" />
                        )}
                        <span className="flex-1 truncate">{r.name}</span>
                        <span className={cn("tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
                          {hasBudget
                            ? `${committed.toFixed(1)}/${budget}h · ${left.toFixed(1)} left`
                            : `${committed.toFixed(1)}h · no budget set`}
                        </span>
                      </div>
                      {hasBudget && (
                        <div className="h-1 rounded-sm bg-muted overflow-hidden">
                          <div
                            className={cn("h-full transition-all", over ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <Link
              to="/settings"
              hash="accounts"
              className="block text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline pt-1"
            >
              Set weekly budgets per account · edit
            </Link>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Your pace</h3>
              {velocity && velocity.hours_per_task > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground" title="Typical hours per completed task (4-week trailing)">
                  ~{velocity.hours_per_task}h / task
                </span>
              )}
            </div>
            {velocity && velocity.tasks_per_week === 0 && velocity.hours_per_week === 0 ? (
              <p className="text-xs text-muted-foreground">
                Not enough history yet — a passive signal of your pace will appear as you complete tasks. No timer, no score.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                You usually complete about <strong className="text-foreground">{velocity?.tasks_per_week ?? 0}</strong> tasks
                and track <strong className="text-foreground">{velocity?.hours_per_week ?? 0}h</strong> a week (4-week average).
              </p>
            )}

            {/* Pace-aware tightness signal (passive, not a score) */}
            {(() => {
              const perTask = velocity?.hours_per_task ?? 0;
              if (perTask <= 0 || committedCount === 0 || effectiveCapacity <= 0) return null;
              const paceLoad = committedCount * perTask + eventLoad;
              const tight = paceLoad > effectiveCapacity;
              if (!tight) return null;
              return (
                <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-2.5">
                  At your usual pace, this week's tasks would take about{" "}
                  <strong className="text-foreground">{(committedCount * perTask).toFixed(1)}h</strong> —
                  this plan may be tight against your {effectiveCapacity.toFixed(0)}h capacity.
                </p>
              );
            })()}

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => review.mutate()}
              disabled={review.isPending || !isPro}
              title={isPro ? "Get a realistic read of this week's plan" : "Pro plan required"}
            >
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              {review.isPending ? "Reading your week…" : isPro ? "Generate realistic read" : "Generate (Pro)"}
            </Button>

            {overPace && (
              <p className="text-[11px] text-muted-foreground">
                You've committed {committedCount} tasks — above your typical pace.
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* Realistic plan preview — user confirms before anything changes */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>A realistic read of your week</DialogTitle>
            <DialogDescription className="text-xs">
              Nothing is changed until you confirm. Untick anything you'd rather keep.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{reviewSummary}</p>
            {reviewRealisticHours > 0 && (
              <p className="text-xs text-muted-foreground">
                Estimated at your pace: <strong className="text-foreground">{reviewRealisticHours}h</strong> across{" "}
                {committedCount} tasks vs <strong className="text-foreground">{effectiveCapacity.toFixed(0)}h</strong> capacity.
              </p>
            )}
            {reviewSuggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No tasks suggested to move — your plan looks well-shaped.
              </p>
            ) : (
              <div className="border rounded-md divide-y max-h-72 overflow-auto">
                {reviewSuggestions.map((s) => {
                  const t = committedFiltered.find((x) => x.id === s.task_id);
                  if (!t) return null;
                  const checked = acceptedDefers.has(s.task_id);
                  return (
                    <label key={s.task_id} className="flex items-start gap-3 p-3 text-sm cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setAcceptedDefers((prev) => {
                            const n = new Set(prev);
                            if (n.has(s.task_id)) n.delete(s.task_id);
                            else n.add(s.task_id);
                            return n;
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{t.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {PRIORITY_LABEL[t.priority]} · move back to backlog
                        </div>
                        {s.reason && (
                          <div className="text-[11px] text-muted-foreground mt-1 italic">{s.reason}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={confirmReview.isPending}>
              Keep as is
            </Button>
            <Button onClick={() => confirmReview.mutate()} disabled={confirmReview.isPending}>
              {confirmReview.isPending
                ? "Applying…"
                : acceptedDefers.size > 0
                  ? `Confirm — defer ${acceptedDefers.size}`
                  : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
        </aside>
      </div>
    </div>
  );
}

function RolledRow({
  task, checked, onToggle, businessName,
}: {
  task: Task; checked: boolean; onToggle: () => void; businessName: string | null;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{task.title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
          <span>{PRIORITY_LABEL[task.priority]}</span>
          {task.committed_week && <span>committed {task.committed_week}</span>}
          {businessName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{businessName}</Badge>
          )}
        </div>
      </div>
    </li>
  );
}

function CommittedRow({
  task, businessName, suggested, onRemove, onDefer,
}: {
  task: Task;
  businessName: string | null;
  suggested: boolean;
  onRemove: () => void;
  onDefer: () => void;
}) {
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", suggested && "bg-amber-50/40 dark:bg-amber-950/20")}>
      <Flag className="h-3.5 w-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm truncate", task.status === "done" && "line-through text-muted-foreground")}>
          {task.title}
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
          <span>{PRIORITY_LABEL[task.priority]}</span>
          {task.due_at && <span>due {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          {businessName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{businessName}</Badge>
          )}
          {suggested && (
            <span className="text-amber-600 dark:text-amber-500 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              suggested to defer
            </span>
          )}
        </div>
      </div>
      {suggested && (
        <Button variant="outline" size="sm" onClick={onDefer}>
          Defer <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} title="Remove from this week">
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
