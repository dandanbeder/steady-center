import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAiPrefs,
  saveAiPrefs,
  getAiUsageThisMonth,
  type AiPrefs,
} from "@/lib/user-prefs";

const MODELS = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet (smart, default)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku (fast, cheaper)" },
];

export function AiPrefsPanel() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({ queryKey: ["ai-prefs"], queryFn: getAiPrefs });
  const { data: usage } = useQuery({ queryKey: ["ai-usage"], queryFn: getAiUsageThisMonth });
  const [draft, setDraft] = useState<AiPrefs | null>(null);
  useEffect(() => {
    if (prefs && !draft) setDraft(prefs);
  }, [prefs, draft]);

  const save = useMutation({
    mutationFn: () => saveAiPrefs(draft!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prefs"] });
      toast.success("AI preferences saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const capDollars = (draft.monthly_cap_cents / 100).toFixed(2);
  const usedCents = usage?.cents ?? 0;
  const pct = draft.monthly_cap_cents > 0 ? Math.min(100, (usedCents / draft.monthly_cap_cents) * 100) : 0;
  const warning = pct >= 80;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4" /> Default model
      </div>
      <Select value={draft.model} onValueChange={(v) => setDraft({ ...draft, model: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {MODELS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
        </SelectContent>
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Summary length</p>
          <Select
            value={draft.summary_length}
            onValueChange={(v) => setDraft({ ...draft, summary_length: v as AiPrefs["summary_length"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Tone</p>
          <Select
            value={draft.tone}
            onValueChange={(v) => setDraft({ ...draft, tone: v as AiPrefs["tone"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="friendly">Friendly</SelectItem>
              <SelectItem value="formal">Formal</SelectItem>
              <SelectItem value="concise">Concise</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Weekly coach style
        </p>
        <Select
          value={draft.coach_style}
          onValueChange={(v) => setDraft({ ...draft, coach_style: v as AiPrefs["coach_style"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="warm">Warm &amp; supportive (default)</SelectItem>
            <SelectItem value="direct">More direct, still kind</SelectItem>
            <SelectItem value="off">Off, just the numbers</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          Sets the tone of weekly reviews and gentle sanity-checks when you plan the week.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Monthly spend cap (USD)
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={capDollars}
            onChange={(e) =>
              setDraft({
                ...draft,
                monthly_cap_cents: Math.max(0, Math.round(Number(e.target.value) * 100)),
              })
            }
            className="w-32"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Enforced server-side. AI features stop working when the cap is reached.
        </p>
      </div>

      <div className="rounded-lg bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Used this month</span>
          <span className={warning ? "text-destructive font-medium" : ""}>
            ${(usedCents / 100).toFixed(2)} / ${capDollars}
          </span>
        </div>
        <div className="h-2 rounded-full bg-background overflow-hidden">
          <div
            className={`h-full transition-all ${warning ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {warning && (
          <p className="text-xs text-destructive">
            You're approaching your monthly cap. Increase it or pause AI features.
          </p>
        )}
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save AI preferences"}
      </Button>
    </div>
  );
}
