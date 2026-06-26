import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Flag,
  Coins,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { suggestOutcomePlan } from "@/lib/outcomes-ai.functions";
import { getCreditBalance } from "@/lib/credits.functions";
import {
  createTask,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  type TaskPriority,
} from "@/lib/tasks";
import type { OutcomeWithProgress } from "@/lib/outcomes";

const ESTIMATED_CREDITS = 3;
const AI_TIMEOUT_MS = 45_000;

type DraftTask = {
  title: string;
  priority: TaskPriority;
  days_offset: number | null;
};

type Phase = "confirm" | "generating" | "preview";

function offsetToIso(days: number | null): string | null {
  if (days == null) return null;
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function OutcomeAIBreakdownDialog({
  outcome,
  open,
  onOpenChange,
  onCreated,
}: {
  outcome: OutcomeWithProgress;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const callSuggest = useServerFn(suggestOutcomePlan);
  const fetchBalance = useServerFn(getCreditBalance);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [drafts, setDrafts] = useState<DraftTask[]>([]);

  const balance = useQuery({
    queryKey: ["credit-balance"],
    queryFn: () => fetchBalance(),
    enabled: open,
  });

  const total = balance.data?.total ?? 0;
  const paused = balance.data?.paused ?? false;
  const insufficient = !balance.isLoading && (paused || total < ESTIMATED_CREDITS);

  const reset = () => {
    setPhase("confirm");
    setDrafts([]);
  };

  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  async function runAi() {
    setPhase("generating");
    try {
      const result = await Promise.race([
        callSuggest({
          data: {
            name: outcome.name,
            success_statement: outcome.success_statement ?? null,
            metric_name: outcome.metric_name ?? null,
            metric_target: outcome.metric_target ?? null,
            metric_unit: outcome.metric_unit ?? null,
            target_date: outcome.target_date ?? null,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out, please try again.")),
            AI_TIMEOUT_MS,
          ),
        ),
      ]);
      setDrafts(result.tasks);
      setPhase("preview");
      void balance.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't generate breakdown.";
      toast.error(msg);
      setPhase("confirm");
    }
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const clean = drafts
        .map((d) => ({ ...d, title: d.title.trim() }))
        .filter((d) => d.title.length > 0);
      if (clean.length === 0) throw new Error("Nothing to save.");
      let pos = 0;
      for (const d of clean) {
        await createTask({
          list_id: null,
          business_id: outcome.business_id ?? null,
          title: d.title,
          priority: d.priority,
          due_at: offsetToIso(d.days_offset),
          position: pos++,
          outcome_id: outcome.id,
        });
      }
      return clean.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} task${n === 1 ? "" : "s"} added to this outcome`);
      onCreated();
      close(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save tasks"),
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> AI breakdown
          </DialogTitle>
          <DialogDescription>
            {phase === "preview"
              ? "Edit freely. Nothing is saved until you confirm."
              : `Turn “${outcome.name}” into clear next steps.`}
          </DialogDescription>
        </DialogHeader>

        {phase !== "preview" && (
          <div className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm space-y-2">
              <p className="flex items-center gap-2 font-medium">
                <Coins className="h-4 w-4 text-primary" />
                This uses about {ESTIMATED_CREDITS} credits
              </p>
              <p className="text-muted-foreground text-xs">
                We'll suggest 3–6 first steps based on your outcome. You'll review and edit
                before any tasks are created.
              </p>
              <p className="text-xs">
                {balance.isLoading ? (
                  <span className="text-muted-foreground">Checking your balance…</span>
                ) : paused ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> AI is paused, you're out of credits this cycle.
                  </span>
                ) : insufficient ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    You have {total} credit{total === 1 ? "" : "s"}, not enough for this action.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    You have {total} credit{total === 1 ? "" : "s"} available.
                  </span>
                )}
              </p>
            </div>

            {phase === "generating" && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating a starter plan…
              </p>
            )}
          </div>
        )}

        {phase === "preview" && (
          <div className="space-y-2">
            <Label>Suggested tasks</Label>
            {drafts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No suggestions. Add tasks manually or close.
              </p>
            )}
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
                      prev.map((x, j) =>
                        j === i ? { ...x, priority: v as TaskPriority } : x,
                      ),
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
                              days_offset:
                                e.target.value === "" ? null : Number(e.target.value),
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
            <p className="text-[11px] text-muted-foreground pt-1">
              These will be linked to this outcome. Nothing is created until you confirm.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => close(false)}
            disabled={phase === "generating" || confirm.isPending}
          >
            Cancel
          </Button>
          {phase === "confirm" && (
            <Button
              onClick={runAi}
              disabled={balance.isLoading || insufficient}
              className="gap-1"
            >
              <Sparkles className="h-4 w-4" />
              Generate (about {ESTIMATED_CREDITS} credits)
            </Button>
          )}
          {phase === "generating" && (
            <Button disabled className="gap-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </Button>
          )}
          {phase === "preview" && (
            <>
              <Button
                variant="ghost"
                onClick={() => setPhase("confirm")}
                disabled={confirm.isPending}
              >
                Discard
              </Button>
              <Button
                onClick={() => confirm.mutate()}
                disabled={
                  confirm.isPending ||
                  drafts.filter((d) => d.title.trim().length > 0).length === 0
                }
              >
                {confirm.isPending
                  ? "Saving…"
                  : `Create ${drafts.filter((d) => d.title.trim().length > 0).length} task${drafts.filter((d) => d.title.trim().length > 0).length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
