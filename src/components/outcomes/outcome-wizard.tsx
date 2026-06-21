import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Target,
  Sparkles,
  ListPlus,
  Forward,
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Loader2,
  Flag,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { createOutcome } from "@/lib/outcomes";
import {
  createTask,
  listFolders,
  listLists,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  type TaskPriority,
} from "@/lib/tasks";
import { suggestOutcomePlan } from "@/lib/outcomes-ai.functions";
import { useServerFn } from "@tanstack/react-start";

type DraftTask = {
  title: string;
  priority: TaskPriority;
  days_offset: number | null;
};

type PlanMode = null | "ai" | "manual" | "skip";

function offsetToIso(days: number | null): string | null {
  if (days == null) return null;
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function OutcomeWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const callSuggest = useServerFn(suggestOutcomePlan);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [successStatement, setSuccessStatement] = useState("");
  const [businessId, setBusinessId] = useState<string>(activeId !== ALL ? activeId : "");

  // Step 2 fields
  const [metricName, setMetricName] = useState("");
  const [metricTarget, setMetricTarget] = useState("");
  const [metricCurrent, setMetricCurrent] = useState("");
  const [metricUnit, setMetricUnit] = useState("");
  const [targetDate, setTargetDate] = useState("");

  // Step 3/4 plan
  const [planMode, setPlanMode] = useState<PlanMode>(null);
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [listId, setListId] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState(false);

  const scopedLists = useMemo(
    () =>
      lists.filter((l) => {
        const f = folders.find((x) => x.id === l.folder_id);
        if (!f) return false;
        return businessId ? f.business_id === businessId : true;
      }),
    [lists, folders, businessId],
  );

  // Auto-pick first scoped list when entering step 4
  if (step === 4 && !listId && scopedLists[0]) {
    setListId(scopedLists[0].id);
  }

  const canNext1 = name.trim().length > 0;

  async function runAi() {
    setLoadingAi(true);
    try {
      const mt = metricTarget.trim() ? Number(metricTarget) : null;
      const res = await callSuggest({
        data: {
          name: name.trim(),
          success_statement: successStatement.trim() || null,
          metric_name: metricName.trim() || null,
          metric_target: mt != null && !Number.isNaN(mt) ? mt : null,
          metric_unit: metricUnit.trim() || null,
          target_date: targetDate || null,
        },
      });
      setDrafts(res.tasks);
      setPlanMode("ai");
      setStep(4);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't get suggestions");
    } finally {
      setLoadingAi(false);
    }
  }

  function startManual() {
    setDrafts([
      { title: "", priority: "normal", days_offset: null },
      { title: "", priority: "normal", days_offset: null },
      { title: "", priority: "normal", days_offset: null },
    ]);
    setPlanMode("manual");
    setStep(4);
  }

  const create = useMutation({
    mutationFn: async () => {
      const mt = metricTarget.trim() ? Number(metricTarget) : null;
      const mc = metricCurrent.trim() ? Number(metricCurrent) : null;
      if (mt != null && Number.isNaN(mt)) throw new Error("Target must be a number");
      if (mc != null && Number.isNaN(mc)) throw new Error("Current must be a number");

      const { id } = await createOutcome({
        business_id: businessId || null,
        name: name.trim(),
        success_statement: successStatement.trim() || null,
        metric_name: metricName.trim() || null,
        metric_target: metricName.trim() ? mt : null,
        metric_current: metricName.trim() ? mc : null,
        metric_unit: metricName.trim() ? (metricUnit.trim() || null) : null,
        target_date: targetDate || null,
        status: "in_progress",
      });

      if (planMode && planMode !== "skip") {
        const clean = drafts
          .map((d) => ({ ...d, title: d.title.trim() }))
          .filter((d) => d.title.length > 0);
        if (clean.length > 0) {
          if (!listId) throw new Error("Pick a list for your starter tasks");
          let pos = 0;
          for (const d of clean) {
            await createTask({
              list_id: listId,
              business_id: businessId || null,
              title: d.title,
              priority: d.priority,
              due_at: offsetToIso(d.days_offset),
              position: pos++,
              outcome_id: id,
            });
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Outcome created");
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> New outcome
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Start with the result you want."}
            {step === 2 && "Optionally add a measurable target and a date."}
            {step === 3 && "Give yourself a clear first step."}
            {step === 4 && "Review your starter plan, you can tweak anything."}
          </DialogDescription>
        </DialogHeader>

        <StepDots step={step} />

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Launch the loyalty programme"
              />
            </div>
            <div>
              <Label>What success looks like</Label>
              <Textarea
                value={successStatement}
                onChange={(e) => setSuccessStatement(e.target.value)}
                rows={3}
                placeholder="A plain statement of the end result. What's true once this is done?"
              />
            </div>
            <div>
              <Label>Account</Label>
              <Select
                value={businessId || "__none"}
                onValueChange={(v) => setBusinessId(v === "__none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Personal</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-md border border-border/60 p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Measurable target, leave blank if not numeric.
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
            <div>
              <Label>Target date</Label>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Every outcome ends better with one concrete first step. Pick how you'd like to start.
            </p>
            <div className="grid grid-cols-1 gap-3">
              <PlanChoice
                icon={<Sparkles className="h-4 w-4 text-primary" />}
                title="Suggest a starting plan"
                description="AI proposes 3–6 sensible first steps. You'll review before anything is created. Counts against your AI allowance."
                onClick={runAi}
                loading={loadingAi}
              />
              <PlanChoice
                icon={<ListPlus className="h-4 w-4" />}
                title="Add first tasks myself"
                description="Type 3–5 first tasks inline. They'll be linked to this outcome."
                onClick={startManual}
              />
              <PlanChoice
                icon={<Forward className="h-4 w-4" />}
                title="Skip for now"
                description="Create the outcome on its own. You can add tasks anytime."
                onClick={() => {
                  setPlanMode("skip");
                  create.mutate();
                }}
                loading={create.isPending && planMode === "skip"}
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <Label>List for these tasks</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger>
                  <SelectValue placeholder={scopedLists.length ? "Pick a list" : "No lists in this account"} />
                </SelectTrigger>
                <SelectContent>
                  {scopedLists.map((l) => {
                    const f = folders.find((x) => x.id === l.folder_id);
                    return (
                      <SelectItem key={l.id} value={l.id}>
                        {f?.name ? `${f.name} / ` : ""}{l.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {scopedLists.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Create a list in Tasks first, then come back, or Skip the starter plan.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Starter tasks</Label>
              {drafts.map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input
                    value={d.title}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                    placeholder={`Task ${i + 1}`}
                    className="flex-1"
                  />
                  <Select
                    value={d.priority}
                    onValueChange={(v) =>
                      setDrafts((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, priority: v as TaskPriority } : x)),
                      )
                    }
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["urgent", "high", "normal", "low"] as TaskPriority[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          <span className="inline-flex items-center gap-2">
                            <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[p] }} />
                            {PRIORITY_LABEL[p]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    value={d.days_offset ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                days_offset: e.target.value === "" ? null : Number(e.target.value),
                              }
                            : x,
                        ),
                      )
                    }
                    placeholder="days"
                    className="w-[80px]"
                    title="Due in N days from today"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDrafts((prev) => [
                    ...prev,
                    { title: "", priority: "normal", days_offset: null },
                  ])
                }
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Add another
              </Button>
              {planMode === "ai" && (
                <p className="text-[11px] text-muted-foreground">
                  AI suggestion, edit freely. Nothing is created until you confirm.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {step > 1 && step !== 3 && (
            <Button
              variant="ghost"
              onClick={() => setStep((s) => (s === 4 ? 3 : ((s - 1) as 1 | 2 | 3)))}
              disabled={create.isPending}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {step === 3 && (
            <Button variant="ghost" onClick={() => setStep(2)} disabled={loadingAi || create.isPending}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!canNext1}>
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)}>
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create outcome & tasks"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepDots({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className={
            "h-1.5 rounded-full transition-all " +
            (n === step ? "w-8 bg-primary" : n < step ? "w-4 bg-primary/50" : "w-4 bg-muted")
          }
        />
      ))}
    </div>
  );
}

function PlanChoice({
  icon,
  title,
  description,
  onClick,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <Card
      onClick={loading ? undefined : onClick}
      className={
        "p-4 cursor-pointer hover:border-primary/50 hover:bg-muted/40 transition-colors " +
        (loading ? "opacity-70 pointer-events-none" : "")
      }
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}</div>
        <div className="flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
    </Card>
  );
}
