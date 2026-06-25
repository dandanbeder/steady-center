import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Target,
  Trophy,
  Archive,
  Trash2,
  CalendarClock,
  AlertTriangle,
  Circle,
  Loader2,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  createOutcome,
  daysRemaining,
  deleteOutcome,
  getOutcomeWithProgress,
  linkTaskToOutcome,
  listLinkableTasksForOutcome,
  listOutcomesWithProgress,
  listTasksForOutcome,
  normaliseOutcomeStatus,
  OUTCOME_STATUS_OPTIONS,
  OUTCOME_STATUS_LABEL,
  updateOutcome,
  type CanonicalOutcomeStatus,
  type OutcomeStatus,
  type OutcomeWithProgress,
} from "@/lib/outcomes";
import { createTask } from "@/lib/tasks";
import { OutcomeWizard } from "@/components/outcomes/outcome-wizard";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link2Off } from "lucide-react";



export const Route = createFileRoute("/_authenticated/outcomes")({
  head: () => ({
    meta: [
      { title: "Outcomes · Heartbeat" },
      { name: "description", content: "Bigger goals that your tasks roll up into." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    focus: typeof s.focus === "string" ? s.focus : undefined,
  }),
  component: OutcomesPage,
});

type TabKey = CanonicalOutcomeStatus;

const TAB_FILTER: Record<TabKey, (s: OutcomeStatus) => boolean> = {
  in_progress: (s) =>
    s === "in_progress" || s === "active" || s === "not_started",
  achieved: (s) => s === "achieved",
  at_risk: (s) => s === "at_risk",
  archived: (s) => s === "archived",
};

function OutcomesPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OutcomeWithProgress | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("in_progress");

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  const scopes = useMemo<Array<string | null>>(() => {
    if (activeId === ALL) return [null, ...businesses.map((b) => b.id)];
    return [activeId];
  }, [activeId, businesses]);

  const { data: outcomes = [], isLoading } = useQuery({
    queryKey: ["outcomes", activeId, businesses.map((b) => b.id).join(",")],
    queryFn: async () => {
      const lists = await Promise.all(scopes.map((s) => listOutcomesWithProgress(s)));
      return lists.flat();
    },
  });

  // Deep-link: ?focus=ID opens the outcome's detail dialog.
  useEffect(() => {
    if (search.focus) {
      setDetailId(search.focus);
      navigate({ search: {} as { focus?: string }, replace: true });
    }
  }, [search.focus, navigate]);

  const bizName = (id: string | null) =>
    id ? (businesses.find((b) => b.id === id)?.name ?? "Account") : "Personal";

  const filtered = outcomes.filter((o) => TAB_FILTER[tab](o.status));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" /> Outcomes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bigger goals your tasks roll up into. Quietly powerful.
          </p>
        </div>
        <Button data-tour="new-outcome" onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New outcome
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {OUTCOME_STATUS_OPTIONS.map((statusOption) => (
            <TabsTrigger key={statusOption.value} value={statusOption.value}>
              {statusOption.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="mt-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              {tab === "in_progress"
                ? "No outcomes in progress. Name something you're working toward."
                : tab === "at_risk"
                  ? "Nothing flagged at risk. Calm seas."
                  : tab === "achieved"
                    ? "Nothing marked done here yet. Soon."
                    : "Nothing archived."}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((o) => (
                <OutcomeCard
                  key={o.id}
                  outcome={o}
                  bizName={bizName(o.business_id)}
                  onOpen={() => setDetailId(o.id)}
                  onEdit={() => setEditing(o)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {creating && (
        <OutcomeWizard
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["outcomes"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      )}
      {editing && (
        <OutcomeDialog
          outcome={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["outcomes"] })}
        />
      )}
      {detailId && (
        <OutcomeDetailDialog
          outcomeId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(o) => {
            setDetailId(null);
            setEditing(o);
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: OutcomeStatus }) {
  const s = normaliseOutcomeStatus(status);
  if (s === "achieved")
    return (
      <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px] gap-1">
        <Trophy className="h-3 w-3" /> Done
      </Badge>
    );
  if (s === "at_risk")
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-700/60">
        <AlertTriangle className="h-3 w-3" /> At risk
      </Badge>
    );
  if (s === "not_started")
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
        Not started
      </Badge>
    );
  if (s === "archived")
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
        <Archive className="h-3 w-3" /> Archived
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] gap-1">
      In progress
    </Badge>
  );
}

function OutcomeCard({
  outcome,
  bizName,
  onOpen,
  onEdit,
}: {
  outcome: OutcomeWithProgress;
  bizName: string;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const days = daysRemaining(outcome.target_date);
  const dueLabel = (() => {
    if (days === null) return null;
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return "Due today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  })();
  const dueClass =
    days === null
      ? ""
      : days < 0
        ? "text-destructive"
        : days <= 7
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";

  const metricPct = (() => {
    if (
      outcome.metric_target == null ||
      outcome.metric_current == null ||
      outcome.metric_target === 0
    )
      return null;
    return Math.min(
      100,
      Math.max(0, Math.round((outcome.metric_current / outcome.metric_target) * 100)),
    );
  })();

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-left flex-1 group"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-base truncate group-hover:text-primary transition-colors">
              {outcome.name}
            </h3>
            <Badge variant="outline" className="text-[10px]">{bizName}</Badge>
            <StatusBadge status={outcome.status} />
          </div>
          {outcome.success_statement && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 italic">
              “{outcome.success_statement}”
            </p>
          )}
          {!outcome.success_statement && outcome.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{outcome.description}</p>
          )}
        </button>
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {outcome.done_tasks} of {outcome.total_tasks} task
            {outcome.total_tasks === 1 ? "" : "s"} complete
          </span>
          <span>{outcome.progress_pct}%</span>
        </div>
        <Progress value={outcome.progress_pct} />
        {outcome.total_tasks > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary" /> {outcome.done_tasks} done
            </span>
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3" /> {outcome.in_progress_tasks} in progress
            </span>
            <span className="inline-flex items-center gap-1">
              <Circle className="h-3 w-3" /> {outcome.todo_tasks} to do
            </span>
          </div>
        )}
      </div>

      {outcome.metric_name && outcome.metric_target != null && (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex justify-between text-xs">
            <span className="font-medium">{outcome.metric_name}</span>
            <span className="text-muted-foreground">
              {outcome.metric_current ?? 0}
              {outcome.metric_unit ? ` ${outcome.metric_unit}` : ""} / {outcome.metric_target}
              {outcome.metric_unit ? ` ${outcome.metric_unit}` : ""}
            </span>
          </div>
          {metricPct !== null && <Progress value={metricPct} />}
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className={"inline-flex items-center gap-1 " + dueClass}>
          <CalendarClock className="h-3.5 w-3.5" />
          {outcome.target_date
            ? new Date(outcome.target_date).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              })
            : "No target date"}
          {dueLabel ? <span className="ml-1">· {dueLabel}</span> : null}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          View tasks <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </Card>
  );
}

function OutcomeDetailDialog({
  outcomeId,
  onClose,
  onEdit,
}: {
  outcomeId: string;
  onClose: () => void;
  onEdit: (o: OutcomeWithProgress) => void;
}) {
  const qc = useQueryClient();
  const { data: outcome, isLoading } = useQuery({
    queryKey: ["outcome-detail", outcomeId],
    queryFn: () => getOutcomeWithProgress(outcomeId),
  });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["outcome-tasks", outcomeId],
    queryFn: () => listTasksForOutcome(outcomeId),
  });

  const [newTitle, setNewTitle] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["outcome-tasks", outcomeId] });
    qc.invalidateQueries({ queryKey: ["outcome-detail", outcomeId] });
    qc.invalidateQueries({ queryKey: ["outcomes"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const addTask = useMutation({
    mutationFn: async () => {
      const title = newTitle.trim();
      if (!title || !outcome) throw new Error("Title required");
      await createTask({
        list_id: null,
        business_id: outcome.business_id ?? null,
        title,
        outcome_id: outcome.id,
      });
    },
    onSuccess: () => {
      setNewTitle("");
      toast.success("Task added");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add task"),
  });

  const linkable = useQuery({
    queryKey: ["outcome-linkable", outcomeId, outcome?.business_id ?? null],
    queryFn: () =>
      listLinkableTasksForOutcome({
        outcomeId,
        businessId: outcome?.business_id ?? null,
      }),
    enabled: linkOpen && !!outcome,
  });

  const linkTask = useMutation({
    mutationFn: (taskId: string) => linkTaskToOutcome(taskId, outcomeId),
    onSuccess: () => {
      toast.success("Linked");
      refresh();
      qc.invalidateQueries({ queryKey: ["outcome-linkable", outcomeId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't link"),
  });

  const unlinkTask = useMutation({
    mutationFn: (taskId: string) => linkTaskToOutcome(taskId, null),
    onSuccess: () => {
      toast.success("Unlinked");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't unlink"),
  });

  const filteredLinkable = useMemo(() => {
    const list = linkable.data ?? [];
    const q = linkSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => t.title.toLowerCase().includes(q));
  }, [linkable.data, linkSearch]);


  const grouped = useMemo(() => {
    const byStatus: Record<string, typeof tasks> = { todo: [], in_progress: [], done: [] };
    for (const t of tasks) {
      const k = t.status === "done" ? "done" : t.status === "in_progress" ? "in_progress" : "todo";
      byStatus[k].push(t);
    }
    return byStatus;
  }, [tasks]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {isLoading || !outcome ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <Target className="h-5 w-5 text-primary" />
                <span>{outcome.name}</span>
                <StatusBadge status={outcome.status} />
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5">
              {outcome.success_statement && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    What success looks like
                  </p>
                  <p className="text-sm italic">“{outcome.success_statement}”</p>
                </div>
              )}
              {outcome.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {outcome.description}
                </p>
              )}

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {outcome.done_tasks} of {outcome.total_tasks} task
                    {outcome.total_tasks === 1 ? "" : "s"} complete
                  </span>
                  <span>{outcome.progress_pct}%</span>
                </div>
                <Progress value={outcome.progress_pct} />
              </div>

              {outcome.metric_name && outcome.metric_target != null && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{outcome.metric_name}</span>
                    <span className="text-muted-foreground">
                      {outcome.metric_current ?? 0}
                      {outcome.metric_unit ? ` ${outcome.metric_unit}` : ""} / {outcome.metric_target}
                      {outcome.metric_unit ? ` ${outcome.metric_unit}` : ""}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(
                      100,
                      Math.max(
                        0,
                        Math.round(
                          ((outcome.metric_current ?? 0) / outcome.metric_target) * 100,
                        ),
                      ),
                    )}
                  />
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-2">Linked tasks</h4>
                {tasksLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tasks linked yet. Open a task and set its Outcome to this one.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {(
                      [
                        ["todo", "To do", Circle],
                        ["in_progress", "In progress", Loader2],
                        ["done", "Done", CheckCircle2],
                      ] as const
                    ).map(([k, label, Icon]) => (
                      grouped[k].length > 0 && (
                        <div key={k}>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 inline-flex items-center gap-1.5">
                            <Icon className="h-3 w-3" /> {label} · {grouped[k].length}
                          </p>
                          <ul className="space-y-1">
                            {grouped[k].map((t) => (
                              <li key={t.id}>
                                <Link
                                  to="/tasks"
                                  search={{ task: t.id }}
                                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm"
                                >
                                  <span className={k === "done" ? "line-through text-muted-foreground" : ""}>
                                    {t.title}
                                  </span>
                                  {t.due_at && (
                                    <span className="text-[11px] text-muted-foreground shrink-0">
                                      {new Date(t.due_at).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  )}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => onEdit(outcome)}>Edit outcome</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeDialog({
  outcome,
  onClose,
  onSaved,
}: {
  outcome?: OutcomeWithProgress;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!outcome;
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  const [name, setName] = useState(outcome?.name ?? "");
  const [successStatement, setSuccessStatement] = useState(outcome?.success_statement ?? "");
  const [description, setDescription] = useState(outcome?.description ?? "");
  const [metricName, setMetricName] = useState(outcome?.metric_name ?? "");
  const [metricTarget, setMetricTarget] = useState<string>(
    outcome?.metric_target != null ? String(outcome.metric_target) : "",
  );
  const [metricCurrent, setMetricCurrent] = useState<string>(
    outcome?.metric_current != null ? String(outcome.metric_current) : "",
  );
  const [metricUnit, setMetricUnit] = useState(outcome?.metric_unit ?? "");
  const [targetDate, setTargetDate] = useState(outcome?.target_date ?? "");
  const [status, setStatus] = useState<OutcomeStatus>(
    outcome ? normaliseOutcomeStatus(outcome.status) : "in_progress",
  );
  const [businessId, setBusinessId] = useState<string>(
    outcome?.business_id ?? (activeId !== ALL ? activeId : ""),
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const mt = metricTarget.trim() ? Number(metricTarget) : null;
      const mc = metricCurrent.trim() ? Number(metricCurrent) : null;
      if (mt != null && Number.isNaN(mt)) throw new Error("Target must be a number");
      if (mc != null && Number.isNaN(mc)) throw new Error("Current must be a number");
      const fields = {
        name: name.trim(),
        success_statement: successStatement.trim() || null,
        description: description.trim() || null,
        metric_name: metricName.trim() || null,
        metric_target: metricName.trim() ? mt : null,
        metric_current: metricName.trim() ? mc : null,
        metric_unit: metricName.trim() ? (metricUnit.trim() || null) : null,
        target_date: targetDate || null,
      };
      if (isEdit) {
        await updateOutcome(outcome!.id, { ...fields, status });
      } else {
        await createOutcome({
          business_id: businessId || null,
          status,
          ...fields,
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Outcome updated" : "Outcome created");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteOutcome(outcome!.id),
    onSuccess: () => {
      toast.success("Outcome deleted");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit outcome" : "New outcome"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Loyalty programme launch"
              autoFocus
            />
          </div>
          {!isEdit && (
            <div>
              <Label>Account</Label>
              <Select value={businessId || "__none"} onValueChange={(v) => setBusinessId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Personal</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>What success looks like</Label>
            <Textarea
              value={successStatement}
              onChange={(e) => setSuccessStatement(e.target.value)}
              rows={2}
              placeholder="A plain statement of the end result. What's true once this is done?"
            />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Context, links, anything useful…"
            />
          </div>

          <div className="rounded-md border border-border/60 p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Measurable target (optional), leave blank if not numeric.
            </p>
            <div>
              <Label>Metric name</Label>
              <Input
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                placeholder="e.g. Active members"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Current</Label>
                <Input
                  type="number"
                  value={metricCurrent}
                  onChange={(e) => setMetricCurrent(e.target.value)}
                  placeholder="0"
                  disabled={!metricName.trim()}
                />
              </div>
              <div>
                <Label>Target</Label>
                <Input
                  type="number"
                  value={metricTarget}
                  onChange={(e) => setMetricTarget(e.target.value)}
                  placeholder="100"
                  disabled={!metricName.trim()}
                />
              </div>
              <div>
                <Label>Unit</Label>
                <Input
                  value={metricUnit}
                  onChange={(e) => setMetricUnit(e.target.value)}
                  placeholder="e.g. £, %"
                  disabled={!metricName.trim()}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Target date</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as OutcomeStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTCOME_STATUS_OPTIONS.map((statusOption) => (
                    <SelectItem key={statusOption.value} value={statusOption.value}>
                      <span className="inline-flex items-center gap-1.5">
                        {statusOption.value === "at_risk" && <AlertTriangle className="h-3.5 w-3.5" />}
                        {statusOption.value === "achieved" && <Trophy className="h-3.5 w-3.5" />}
                        {statusOption.value === "archived" && <Archive className="h-3.5 w-3.5" />}
                        {OUTCOME_STATUS_LABEL[statusOption.value]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {isEdit && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              onClick={() => {
                if (confirm("Delete this outcome? Linked tasks will be unlinked.")) del.mutate();
              }}
              disabled={del.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
