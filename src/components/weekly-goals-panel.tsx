import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Target, Check, X, Heart, Info, Sparkles, Loader2 } from "lucide-react";
import { coachWeekCheck } from "@/lib/coach.functions";
import { suggestWeeklyGoals, type SuggestedGoal } from "@/lib/weekly-goals-ai.functions";
import { isCreditsExhaustedError } from "@/lib/credits";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { listBusinesses } from "@/lib/businesses";
import {
  carryForwardUnmet,
  createGoal,
  deleteGoal,
  getWeekRange,
  refreshGoalsForWeek,
  updateGoal,
  type GoalMetricType,
  type WeeklyGoal,
} from "@/lib/weekly-goals";
import { cn } from "@/lib/utils";

function LabelWithTooltip({ label, tooltip }: { label: React.ReactNode; tooltip: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={tooltip}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

const MAX_GOALS = 5;

export function WeeklyGoalsPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { start: weekStart, end: weekEnd } = getWeekRange();
  const weekKey = weekStart.toISOString();

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["weekly-goals", weekKey],
    queryFn: async () => {
      await carryForwardUnmet();
      return refreshGoalsForWeek(weekStart);
    },
    refetchOnWindowFocus: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["weekly-goals", weekKey] });

  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedGoal[] | null>(null);

  const suggestFn = useServerFn(suggestWeeklyGoals);
  const weekStartDate = weekStart.toISOString().slice(0, 10);

  async function runSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("TIMEOUT")), 30_000),
    );
    try {
      const res = await Promise.race([
        suggestFn({ data: { week_start: weekStartDate } }),
        timeout,
      ]);
      if (!res.suggestions.length) {
        toast.message("No suggestions this time — try again or add one manually.");
        return;
      }
      setSuggestions(res.suggestions);
    } catch (e) {
      if (isCreditsExhaustedError(e)) {
        toast.error("You're out of AI credits. Top up or wait for your next cycle.");
      } else if (e instanceof Error && e.message === "TIMEOUT") {
        toast.error("AI took too long. Try again in a moment.");
      } else {
        toast.error(
          e instanceof Error ? e.message : "Couldn't generate suggestions — try again.",
        );
      }
    } finally {
      setSuggesting(false);
    }
  }


  // Forward-looking gentle coach check, reflects back the week and flags overload.
  const coachFn = useServerFn(coachWeekCheck);
  const weekStartDay = weekStart.toISOString().slice(0, 10);
  const { data: coach } = useQuery({
    queryKey: ["coach-week", weekStartDay, goals.length],
    queryFn: () => coachFn({ data: { week_start: weekStartDay } }),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "met" | "missed" | "open" }) =>
      updateGoal(id, { status }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteGoal(id),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-soft)" }}>
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className={cn("text-primary", compact ? "text-xl" : "text-2xl")}>
            This week's goals
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
            {new Date(weekEnd.getTime() - 1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={runSuggest}
            disabled={suggesting || goals.length >= MAX_GOALS}
            title={
              goals.length >= MAX_GOALS
                ? "Up to 5 goals per week"
                : "Suggest goals for this week with AI"
            }
          >
            {suggesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate
          </Button>
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            disabled={goals.length >= MAX_GOALS}
            title={goals.length >= MAX_GOALS ? "Up to 5 goals per week" : "Add goal"}
          >
            <Plus className="h-3.5 w-3.5" /> Add goal
          </Button>
        </div>
      </header>

      {coach?.enabled && coach.note && (
        <div
          className={cn(
            "mb-4 rounded-lg border p-3 flex gap-3 items-start text-sm",
            coach.facts.load_pct > 110
              ? "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20"
              : "border-border bg-muted/40",
          )}
        >
          <Heart className="h-4 w-4 mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <p className="text-foreground/90 leading-relaxed">{coach.note}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {coach.facts.goals} goals · {coach.facts.committed_tasks} tasks ·{" "}
              {coach.facts.meeting_hours}h meetings · ~{coach.facts.load_pct}% of capacity
            </p>
          </div>
        </div>
      )}


      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No goals yet. Set 1–5 measurable goals for the week.
        </p>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              businessName={g.business_id ? businesses.find((b) => b.id === g.business_id)?.name : null}
              onMarkMet={() => mark.mutate({ id: g.id, status: "met" })}
              onMarkMissed={() => mark.mutate({ id: g.id, status: "missed" })}
              onReopen={() => mark.mutate({ id: g.id, status: "open" })}
              onDelete={() => del.mutate(g.id)}
            />
          ))}
        </ul>
      )}

      {adding && (
        <GoalDialog
          weekStart={weekStart}
          weekEnd={weekEnd}
          businesses={businesses}
          onClose={() => setAdding(false)}
          onSaved={() => {
            invalidate();
            setAdding(false);
          }}
        />
      )}

      {suggestions && (
        <SuggestionsDialog
          weekStart={weekStart}
          weekEnd={weekEnd}
          businesses={businesses}
          initial={suggestions}
          existingCount={goals.length}
          maxGoals={MAX_GOALS}
          onClose={() => setSuggestions(null)}
          onSaved={() => {
            invalidate();
            setSuggestions(null);
          }}
        />
      )}
    </section>
  );
}

function GoalRow({
  goal,
  businessName,
  onMarkMet,
  onMarkMissed,
  onReopen,
  onDelete,
}: {
  goal: WeeklyGoal;
  businessName: string | null | undefined;
  onMarkMet: () => void;
  onMarkMissed: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const hasTarget = goal.target_value != null && goal.target_value > 0;
  const pct = hasTarget
    ? Math.min(100, Math.round((goal.current_value / (goal.target_value as number)) * 100))
    : goal.status === "met"
      ? 100
      : 0;

  const unit =
    goal.metric_type === "hours" ? "h" :
    goal.metric_type === "tasks_completed" ? " tasks" : "";

  return (
    <li className="rounded-lg border border-border p-3 bg-background">
      <div className="flex items-start gap-3">
        <Target className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{goal.title}</span>
            {businessName && (
              <Badge variant="secondary" className="text-[10px]">{businessName}</Badge>
            )}
            {goal.carried_from && (
              <Badge variant="outline" className="text-[10px]">carried over</Badge>
            )}
            {goal.status === "met" && (
              <Badge className="text-[10px] bg-[oklch(0.72_0.16_150)] text-white border-transparent">met</Badge>
            )}
            {goal.status === "missed" && (
              <Badge variant="destructive" className="text-[10px]">missed</Badge>
            )}
          </div>
          {goal.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{goal.description}</p>
          )}
          {hasTarget ? (
            <div className="mt-2 space-y-1">
              <Progress value={pct} className="h-1.5" />
              <div className="text-[11px] text-muted-foreground flex justify-between">
                <span>
                  {goal.current_value}{unit} of {goal.target_value}{unit}
                </span>
                <span>{pct}%</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">No measurable target</div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {goal.status === "open" ? (
            <>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Mark met" onClick={onMarkMet}>
                <Check className="h-3.5 w-3.5 text-[oklch(0.72_0.16_150)]" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Mark missed" onClick={onMarkMissed}>
                <X className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={onReopen}>
              Reopen
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function GoalDialog({
  weekStart,
  weekEnd,
  businesses,
  onClose,
  onSaved,
}: {
  weekStart: Date;
  weekEnd: Date;
  businesses: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metric, setMetric] = useState<GoalMetricType>("custom");
  const [target, setTarget] = useState<string>("");
  const [businessId, setBusinessId] = useState<string>("__none");

  useEffect(() => {
    if (metric === "custom") setTarget("");
  }, [metric]);

  const save = useMutation({
    mutationFn: () =>
      createGoal({
        title,
        description: description || null,
        metric_type: metric,
        target_value: metric === "custom" ? null : target ? parseFloat(target) : null,
        business_id: businessId === "__none" ? null : businessId,
        week_start: weekStart,
        week_end: weekEnd,
      }),
    onSuccess: () => {
      toast.success("Goal added");
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New weekly goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship onboarding flow" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <LabelWithTooltip
                  label="Measure"
                  tooltip="How you'll know you're making progress - the number or outcome you're tracking"
                />
                <Select value={metric} onValueChange={(v) => setMetric(v as GoalMetricType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom (mark by hand)</SelectItem>
                    <SelectItem value="tasks_completed">Tasks completed</SelectItem>
                    <SelectItem value="hours">Hours logged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Target {metric === "hours" ? "(h)" : metric === "tasks_completed" ? "(tasks)" : ""}</Label>
                <Input
                  type="number"
                  min={0}
                  step={metric === "hours" ? 0.5 : 1}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={metric === "custom"}
                  placeholder={metric === "custom" ? "," : "e.g. 10"}
                />
              </div>
            </div>
            <div>
              <LabelWithTooltip
                label="Account (optional)"
                tooltip="Which of your businesses or areas this goal belongs to"
              />
              <Select value={businessId} onValueChange={setBusinessId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">All Accounts</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!title.trim() || save.isPending}
            >
              Add goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
