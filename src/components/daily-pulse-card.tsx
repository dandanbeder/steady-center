import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Sunrise, Moon, Sparkles, Check, ArrowRight, Loader2, Wind } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  completeTask, confirmFocus3, getTodaysPulses, rollForwardTask, type DailyPulse, type FocusItem,
} from "@/lib/daily-pulse";
import { generateMyPulse } from "@/lib/daily-pulse.functions";
import { getQuoteOfTheDay } from "@/lib/daily-quotes";

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
    mutationFn: (kind: "morning" | "evening") => generate({ data: { kind } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-pulses", "today"] });
      toast.success("Pulse refreshed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
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
  const qc = useQueryClient();
  const [step, setStep] = useState<"review" | "focus" | "breathe">(
    pulse.confirmed_focus_at ? "breathe" : "review",
  );
  const [focusDraft, setFocusDraft] = useState<FocusItem[]>(pulse.focus_3);

  const reviewItems = pulse.meetings_json; // reuse, also could fetch today's open tasks
  // Use focus_3 as the "today's open tasks" review surface
  const taskItems = pulse.focus_3;

  const handleComplete = async (id: string) => {
    try {
      await completeTask(id);
      toast.success("Marked done");
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };
  const handleRoll = async (id: string) => {
    try {
      await rollForwardTask(id);
      toast.success("Rolled to tomorrow");
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const confirmFocus = async () => {
    try {
      await confirmFocus3(pulse.id, focusDraft);
      toast.success("Tomorrow's focus set");
      setStep("breathe");
      qc.invalidateQueries({ queryKey: ["daily-pulses", "today"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-muted/30 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Moon className="h-5 w-5 text-accent mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Evening wind-down</p>
          <p className="text-sm leading-relaxed mt-1 text-foreground/90">{pulse.summary_text}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex gap-1 text-xs">
        <StepDot active={step === "review"} label="1 Review" onClick={() => setStep("review")} />
        <StepDot active={step === "focus"} label="2 Focus" onClick={() => setStep("focus")} />
        <StepDot active={step === "breathe"} label="3 Breathe" onClick={() => setStep("breathe")} />
      </div>

      {step === "review" && (
        <div className="space-y-2">
          {taskItems.length === 0 && reviewItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open today. Nice.</p>
          ) : (
            <>
              {taskItems.map((t) => (
                <div key={t.task_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{t.title}</span>
                  <Button size="sm" variant="outline" onClick={() => handleComplete(t.task_id)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleRoll(t.task_id)} title="Roll to tomorrow">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </>
          )}
          <Button size="sm" className="w-full mt-2" onClick={() => setStep("focus")}>
            Next: Set tomorrow's focus
          </Button>
        </div>
      )}

      {step === "focus" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">AI suggested these for tomorrow. Edit titles or confirm.</p>
          {focusDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suggestions. Add what matters tomorrow on the Tasks page.</p>
          ) : (
            focusDraft.map((f, i) => (
              <div key={f.task_id} className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm tabular-nums w-5">{i + 1}.</span>
                <input
                  className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none text-sm py-1"
                  value={f.title}
                  onChange={(e) => {
                    const next = [...focusDraft];
                    next[i] = { ...f, title: e.target.value };
                    setFocusDraft(next);
                  }}
                />
              </div>
            ))
          )}
          <Button size="sm" className="w-full mt-2" onClick={confirmFocus}>
            Confirm Focus 3
          </Button>
        </div>
      )}

      {step === "breathe" && <BreatheWidget />}
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

function BreatheWidget() {
  const [running, setRunning] = useState(false);
  return (
    <div className="flex flex-col items-center py-4 gap-3">
      <div
        className={`h-24 w-24 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center transition-all duration-[4000ms] ease-in-out ${
          running ? "scale-125" : "scale-100"
        }`}
        style={running ? { animation: "pulse-breathe 8s ease-in-out infinite" } : undefined}
      >
        <Wind className="h-8 w-8 text-primary" />
      </div>
      <p className="text-sm text-muted-foreground">
        {running ? "Breathe in… hold… breathe out…" : "1 minute of box breathing, 4 in, 4 hold, 4 out, 4 hold."}
      </p>
      <Button size="sm" variant={running ? "outline" : "default"} onClick={() => setRunning(!running)}>
        {running ? "Done" : "Start breathing"}
      </Button>
      <style>{`
        @keyframes pulse-breathe {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.3); }
          50% { transform: scale(1.3); }
          75% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
