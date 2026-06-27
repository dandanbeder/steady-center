import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Sunrise, Moon, Sparkles, Loader2, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  getTodaysPulses, type DailyPulse,
} from "@/lib/daily-pulse";
import { generateMyPulse } from "@/lib/daily-pulse.functions";
import { getQuoteOfTheDay, DAILY_QUOTES, type DailyQuote } from "@/lib/daily-quotes";
import { supabase } from "@/integrations/supabase/client";
import type { Task } from "@/lib/tasks";


function DailyQuote() {
  const q = getQuoteOfTheDay();
  return (
    <figure className="border-l-2 border-accent/40 pl-3 py-1">
      <blockquote className="font-serif italic text-sm leading-relaxed text-muted-foreground">
        “{q.quote}”
      </blockquote>
      <figcaption className="mt-1 text-xs not-italic text-muted-foreground/70">
       , {q.author}
      </figcaption>
    </figure>
  );
}

export function DailyPulseCard() {
  const qc = useQueryClient();
  const generate = useServerFn(generateMyPulse);

  const { data, isLoading } = useQuery({
    queryKey: ["daily-pulses", "today"],
    queryFn: () => getTodaysPulses(),
    refetchInterval: 60_000,
  });

  const morning = data?.morning;
  const evening = data?.evening;
  const localHour = new Date().getHours();
  const showEvening = localHour >= 17;

  const genMut = useMutation({
    mutationFn: async (kind: "morning" | "evening") => {
      // Calm safety net: never let the spinner hang. If the server takes longer
      // than ~30s (AI timeout, network stall), we bail out gracefully.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30_000),
      );
      return (await Promise.race([generate({ data: { kind } }), timeout])) as Awaited<
        ReturnType<typeof generate>
      >;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-pulses", "today"] });
      toast.success("Pulse refreshed");
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (msg.includes("402") || msg.includes("credit")) {
        toast.error("Out of AI credits, your pulse will be ready once credits are topped up.");
      } else if (msg.includes("429") || msg.includes("rate")) {
        toast.error("AI is busy right now. Try again in a moment.");
      } else if (msg === "timeout") {
        toast.error("Couldn't reach the AI in time. Try again in a moment.");
      } else {
        toast.error("Couldn't generate your pulse just now. Try again.");
      }
    },
  });


  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-5 mb-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      {!morning ? (
        <EmptyPulse
          kind="morning"
          onGenerate={() => genMut.mutate("morning")}
          busy={genMut.isPending}
        />
      ) : (
        <MorningPulseCard pulse={morning} onRefresh={() => genMut.mutate("morning")} busy={genMut.isPending} />
      )}

      {showEvening && (
        !evening ? (
          <EmptyPulse
            kind="evening"
            onGenerate={() => genMut.mutate("evening")}
            busy={genMut.isPending}
          />
        ) : (
          <EveningWindDownCard pulse={evening} onRefresh={() => genMut.mutate("evening")} busy={genMut.isPending} />
        )
      )}
    </div>
  );
}

function EmptyPulse({ kind, onGenerate, busy }: { kind: "morning" | "evening"; onGenerate: () => void; busy: boolean }) {
  const Icon = kind === "morning" ? Sunrise : Moon;
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {kind === "morning" ? "Morning pulse" : "Evening wind-down"}
          </p>
          <p className="text-xs text-muted-foreground">
            {kind === "morning"
              ? "Not generated yet today. Generate a calm brief now or wait for your scheduled time."
              : "Take 2 minutes to close the loop and set tomorrow's focus."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
        </Button>
      </div>
      {kind === "morning" && <DailyQuote />}
    </div>
  );
}

function MorningPulseCard({ pulse, onRefresh, busy }: { pulse: DailyPulse; onRefresh: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-muted/30 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Sunrise className="h-5 w-5 text-accent mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Morning pulse</p>
          <p className="text-sm leading-relaxed mt-1 text-foreground/90">{pulse.summary_text}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <Stat label="Load" value={`${pulse.scheduled_hours}h / ${pulse.capacity_hours}h`} />
        <Stat label="Overdue" value={String(pulse.overdue_count)} tone={pulse.overdue_count > 0 ? "warn" : undefined} />
        <Stat label="Meetings" value={String(pulse.meetings_json.length)} />
      </div>

      {pulse.focus_3.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Focus 3</p>
          <ol className="space-y-1.5">
            {pulse.focus_3.map((f, i) => (
              <li key={f.task_id} className="text-sm flex items-baseline gap-2">
                <span className="text-muted-foreground tabular-nums w-5">{i + 1}.</span>
                <span className="truncate">{f.title}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <DailyQuote />
    </div>
  );
}

function EveningWindDownCard({ pulse, onRefresh, busy }: { pulse: DailyPulse; onRefresh: () => void; busy: boolean }) {
  const [step, setStep] = useState<"review" | "focus" | "breathe">("review");

  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-muted/30 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Moon className="h-5 w-5 text-accent mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Evening wind-down</p>
          <p className="text-sm leading-relaxed mt-1 text-foreground/90">
            A calm close to the day, in three short steps.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={busy} className="shrink-0" title="Refresh AI summary">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex gap-1 text-xs">
        <StepDot active={step === "review"} label="1 · Review" onClick={() => setStep("review")} />
        <StepDot active={step === "focus"} label="2 · Focus" onClick={() => setStep("focus")} />
        <StepDot active={step === "breathe"} label="3 · Breathe" onClick={() => setStep("breathe")} />
      </div>

      {step === "review" && <ReviewStep pulse={pulse} onNext={() => setStep("focus")} />}
      {step === "focus" && <FocusStep onNext={() => setStep("breathe")} />}
      {step === "breathe" && <BreatheStep />}
    </div>
  );
}

function ReviewStep({ pulse, onNext }: { pulse: DailyPulse; onNext: () => void }) {
  // The AI summary is generated by the parent (Generate / refresh button), invoked by the user.
  // Meter + log + graceful failure already handled in genMut at the card level.
  return (
    <div className="space-y-3">
      {pulse.summary_text ? (
        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{pulse.summary_text}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No summary yet. Tap the sparkle above to generate a calm recap of your day.
        </p>
      )}
      <Button size="sm" variant="outline" className="w-full" onClick={onNext}>
        Next · Focus
      </Button>
    </div>
  );
}

async function listFocusTasks(): Promise<Task[]> {
  const nowIso = new Date().toISOString();
  // Open tasks that are EITHER high priority (urgent/high) OR already overdue.
  // RLS on `tasks` keeps this scoped to the signed-in user automatically.
  const [hi, overdue] = await Promise.all([
    supabase.from("tasks").select("*")
      .is("deleted_at", null).neq("status", "done")
      .in("priority", ["urgent", "high"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase.from("tasks").select("*")
      .is("deleted_at", null).neq("status", "done")
      .not("due_at", "is", null).lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(10),
  ]);
  if (hi.error) throw hi.error;
  if (overdue.error) throw overdue.error;
  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const t of [...(hi.data ?? []), ...(overdue.data ?? [])] as Task[]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
  }
  return merged.slice(0, 8);
}

function FocusStep({ onNext }: { onNext: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["evening-focus-tasks"],
    queryFn: listFocusTasks,
  });
  const nowMs = Date.now();
  const tasks = data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Still open and high priority or overdue, so nothing slips into tomorrow.
      </p>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">All clear. Nothing urgent left open.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const overdue = t.due_at && new Date(t.due_at).getTime() < nowMs;
            const high = t.priority === "urgent" || t.priority === "high";
            return (
              <li key={t.id}>
                <Link
                  to="/tasks"
                  className="flex items-center gap-2 text-sm rounded hover:bg-muted/40 transition-colors py-1 px-1 -mx-1"
                >
                  {overdue ? (
                    <Clock className="h-3.5 w-3.5 text-destructive shrink-0" />
                  ) : high ? (
                    <AlertCircle className="h-3.5 w-3.5 text-accent shrink-0" />
                  ) : null}
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                    {overdue ? "Overdue" : t.priority}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Button size="sm" variant="outline" className="w-full" onClick={onNext}>
        Next · Breathe
      </Button>
    </div>
  );
}

function BreatheStep() {
  // Deterministic per-day quote from a curated, vetted list (correct attributions).
  const [q, setQ] = useState<DailyQuote>(() => getQuoteOfTheDay());
  const shuffle = () => {
    let next = q;
    while (next.quote === q.quote && DAILY_QUOTES.length > 1) {
      next = DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)];
    }
    setQ(next);
  };
  return (
    <div className="py-2 space-y-3">
      <figure className="border-l-2 border-accent/40 pl-4 py-2">
        <blockquote className="font-serif italic text-base leading-relaxed text-foreground/90">
          “{q.quote}”
        </blockquote>
        <figcaption className="mt-2 text-xs not-italic text-muted-foreground">
         , {q.author}
        </figcaption>
      </figure>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={shuffle} className="text-xs">
          Another
        </Button>
      </div>
    </div>
  );
}

function StepDot({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-md py-2 ${tone === "warn" ? "bg-destructive/10 text-destructive" : "bg-muted/40"}`}>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

