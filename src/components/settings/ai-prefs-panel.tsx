import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  type AiPrefs,
} from "@/lib/user-prefs";
import { usePlanContext } from "@/hooks/use-plan-context";

const SUMMARY_OPTIONS: { value: AiPrefs["summary_length"]; label: string; hint: string }[] = [
  { value: "short", label: "Short", hint: "A few key bullets, fastest to scan." },
  { value: "medium", label: "Medium", hint: "Balanced detail, the default." },
  { value: "long", label: "Long", hint: "Fuller context with supporting points." },
];

const TONE_OPTIONS: { value: AiPrefs["tone"]; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Clear and matter-of-fact." },
  { value: "friendly", label: "Friendly", hint: "Warmer, conversational phrasing." },
  { value: "formal", label: "Formal", hint: "More polished, business-ready." },
  { value: "concise", label: "Concise", hint: "Tight wording, minimal filler." },
];

const COACH_OPTIONS: { value: AiPrefs["coach_style"]; label: string; hint: string }[] = [
  { value: "warm", label: "Warm & supportive", hint: "Encouraging tone, the default." },
  { value: "direct", label: "Direct, still kind", hint: "Straightforward, gently honest." },
  { value: "off", label: "Off, just the numbers", hint: "No coaching language, facts only." },
];

export function AiPrefsPanel() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({ queryKey: ["ai-prefs"], queryFn: getAiPrefs });
  const { plan } = usePlanContext();
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

  const used = plan?.aiUsed ?? 0;
  const cap = plan?.aiCap ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = cap > 0 && used >= cap;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Summary length</p>
        <Select
          value={draft.summary_length}
          onValueChange={(v) => setDraft({ ...draft, summary_length: v as AiPrefs["summary_length"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUMMARY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {SUMMARY_OPTIONS.find((o) => o.value === draft.summary_length)?.hint}
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Tone</p>
        <Select
          value={draft.tone}
          onValueChange={(v) => setDraft({ ...draft, tone: v as AiPrefs["tone"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {TONE_OPTIONS.find((o) => o.value === draft.tone)?.hint}
        </p>
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
            {COACH_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {COACH_OPTIONS.find((o) => o.value === draft.coach_style)?.hint}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            AI credits this month
          </div>
          <span className={`text-sm tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
            {used.toLocaleString()} / {cap.toLocaleString()} credits
          </span>
        </div>
        <Progress value={pct} className={over ? "[&>div]:bg-destructive" : ""} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {over
              ? "You've used this month's credits. Top up to keep AI features running."
              : "Credits refresh on your billing date."}
          </span>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/billing">Manage</Link>
          </Button>
        </div>
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save AI preferences"}
      </Button>
    </div>
  );
}
