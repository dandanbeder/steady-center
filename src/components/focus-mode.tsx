import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pause, Play, X, Sparkles, Timer as TimerIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  getRunningTimer,
  startTimer,
  stopTimer,
  formatMinutes,
} from "@/lib/time-entries";
import { rolloverRecurring, updateTask, type Task } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** A small, pleasant chime via WebAudio, no asset needed. */
function playChime() {
  try {
    const AC =
      (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext);
    const ctx = new AC();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t0 = now + i * 0.18;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 1);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2500);
  } catch {
    /* ignore */
  }
}

function useNow(ms = 1000, active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

const DURATIONS = [
  { label: "Open", min: 0 },
  { label: "25 min", min: 25 },
  { label: "50 min", min: 50 },
];

export function FocusMode({
  task,
  onClose,
  onChange,
}: {
  task: Task;
  onClose: () => void;
  onChange?: () => void;
}) {
  const qc = useQueryClient();
  const [duration, setDuration] = useState<number>(0); // minutes, 0 = open
  const [completed, setCompleted] = useState(false);
  const [breathing, setBreathing] = useState(false);
  const chimedRef = useRef(false);

  const { data: running, isLoading: runningLoading } = useQuery({
    queryKey: ["time-running"],
    queryFn: getRunningTimer,
    refetchInterval: 15_000,
  });
  const isThisRunning = running?.task_id === task.id;

  const { data: subtasks = [], refetch: refetchSubtasks } = useQuery({
    queryKey: ["focus-subtasks", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status")
        .eq("parent_task_id", task.id)
        .is("deleted_at", null)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<Pick<Task, "id" | "title" | "status">>;
    },
  });

  useNow(1000, isThisRunning);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["time-running"] });
    qc.invalidateQueries({ queryKey: ["time-week-totals"] });
    qc.invalidateQueries({ queryKey: ["time-task-totals"] });
    qc.invalidateQueries({ queryKey: ["time-entries", task.id] });
  };

  const start = useMutation({
    mutationFn: () => startTimer({ id: task.id, business_id: task.business_id }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const stop = useMutation({
    mutationFn: () => stopTimer(running!),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Auto-start on enter, only once the running-timer query has resolved,
  // and only if no other task's timer is already running (otherwise leave it
  // alone so we don't silently corrupt time tracking).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (runningLoading || autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (!running) start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningLoading, running]);

  const elapsedMs = useMemo(() => {
    if (!isThisRunning || !running) return 0;
    return Math.max(0, Date.now() - +new Date(running.started_at));
  }, [isThisRunning, running]);

  const targetMs = duration * 60_000;
  const remainingMs = targetMs > 0 ? Math.max(0, targetMs - elapsedMs) : 0;
  const reachedTarget = targetMs > 0 && elapsedMs >= targetMs;

  // Chime when target reached
  useEffect(() => {
    if (reachedTarget && !chimedRef.current) {
      chimedRef.current = true;
      playChime();
      toast.success(`${duration} minutes focused, well done.`);
    }
    if (!reachedTarget) chimedRef.current = false;
  }, [reachedTarget, duration]);

  const exit = async () => {
    if (isThisRunning && running) {
      try {
        await stopTimer(running);
        invalidate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not stop the timer");
      }
    }
    onClose();
  };

  // ESC to leave
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !completed && !breathing) {
        e.preventDefault();
        void exit();
      }
    };
    window.addEventListener("keydown", onKey);
    // Hide body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, breathing, running]);

  const toggleSubtask = useMutation({
    mutationFn: async (s: { id: string; status: string }) => {
      await updateTask(s.id, {
        status: s.status === "done" ? "todo" : "done",
      });
    },
    onSuccess: () => {
      refetchSubtasks();
      onChange?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update subtask"),
  });

  const completeTask = useMutation({
    mutationFn: async () => {
      await updateTask(task.id, { status: "done" });
      if (task.recurrence_rule) await rolloverRecurring(task);
      if (isThisRunning && running) {
        await stopTimer(running);
      }
    },
    onSuccess: () => {
      invalidate();
      onChange?.();
      setCompleted(true);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);

  const display =
    targetMs > 0
      ? `${String(remainingMin).padStart(2, "0")}:${String(remainingSec).padStart(2, "0")}`
      : `${String(elapsedMin).padStart(2, "0")}:${String(elapsedSec).padStart(2, "0")}`;

  const node = (
    <div
      className="fixed inset-0 z-[100] bg-background text-foreground overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
    >
      {/* Quiet exit */}
      <button
        onClick={() => void exit()}
        className="fixed top-3 right-3 sm:top-5 sm:right-5 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-muted/40 transition"
        aria-label="Leave focus mode"
      >
        <X className="h-3.5 w-3.5" /> Leave focus
        <kbd className="hidden sm:inline ml-1 text-[10px] text-muted-foreground/70 border border-border rounded px-1 py-0.5">
          Esc
        </kbd>
      </button>

      {completed ? (
        <CompletionMoment
          onDone={() => {
            onClose();
          }}
          onBreathe={() => setBreathing(true)}
          breathing={breathing}
          onBreathingDone={() => {
            setBreathing(false);
          }}
        />
      ) : (
        <div className="min-h-screen flex flex-col items-center justify-start sm:justify-center px-5 py-16 sm:py-12">
          <div className="w-full max-w-2xl space-y-10">
            {/* Title */}
            <div className="text-center space-y-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Focus
              </p>
              <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
                {task.title}
              </h1>
              {task.description && (
                <p className="text-base text-muted-foreground whitespace-pre-wrap max-w-xl mx-auto">
                  {task.description}
                </p>
              )}
            </div>

            {/* Timer */}
            <div className="flex flex-col items-center gap-4">
              <div
                className={cn(
                  "font-mono tabular-nums text-6xl sm:text-7xl tracking-tight",
                  reachedTarget && "text-accent",
                )}
                aria-live="polite"
              >
                {display}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.min}
                    onClick={() => setDuration(d.min)}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-full border transition",
                      duration === d.min
                        ? "bg-foreground text-background border-foreground"
                        : "bg-transparent text-muted-foreground border-border hover:text-foreground",
                    )}
                  >
                    {d.min === 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <TimerIcon className="h-3 w-3" />
                        {d.label}
                      </span>
                    ) : (
                      d.label
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2">
                {isThisRunning ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => stop.mutate()}
                    disabled={stop.isPending}
                  >
                    <Pause className="h-3.5 w-3.5 mr-1.5" />
                    Pause
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => start.mutate()}
                    disabled={start.isPending}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Resume
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatMinutes(elapsedMin)} this session
                </span>
              </div>
            </div>

            {/* Subtasks */}
            {subtasks.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Subtasks ·{" "}
                  {subtasks.filter((s) => s.status === "done").length}/
                  {subtasks.length}
                </p>
                {subtasks.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 py-1.5 cursor-pointer group"
                  >
                    <Checkbox
                      checked={s.status === "done"}
                      onCheckedChange={() => toggleSubtask.mutate(s)}
                    />
                    <span
                      className={cn(
                        "text-base flex-1",
                        s.status === "done" &&
                          "line-through text-muted-foreground",
                      )}
                    >
                      {s.title}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Complete */}
            <div className="flex justify-center pt-2">
              <Button
                size="lg"
                onClick={() => completeTask.mutate()}
                disabled={completeTask.isPending || task.status === "done"}
                className="rounded-full px-8"
              >
                <Check className="h-4 w-4 mr-2" />
                {task.status === "done" ? "Completed" : "Mark complete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

function CompletionMoment({
  onDone,
  onBreathe,
  breathing,
  onBreathingDone,
}: {
  onDone: () => void;
  onBreathe: () => void;
  breathing: boolean;
  onBreathingDone: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
      {breathing ? (
        <BoxBreathing onDone={onBreathingDone} />
      ) : (
        <div className="space-y-6 max-w-md">
          <div className="mx-auto h-16 w-16 rounded-full bg-accent/15 flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-accent" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">Done.</h2>
            <p className="text-sm text-muted-foreground">
              Take a breath before the next thing.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Button variant="outline" onClick={onBreathe}>
              One breathing cycle
            </Button>
            <Button onClick={onDone}>Return</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Single 4-4-4-4 box-breathing cycle (16 seconds), then onDone. */
function BoxBreathing({ onDone }: { onDone: () => void }) {
  const phases = useMemo(
    () => [
      { label: "Breathe in", ms: 4000, scale: 1 },
      { label: "Hold", ms: 4000, scale: 1 },
      { label: "Breathe out", ms: 4000, scale: 0.6 },
      { label: "Hold", ms: 4000, scale: 0.6 },
    ],
    [],
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= phases.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setIdx((n) => n + 1), phases[idx].ms);
    return () => clearTimeout(t);
  }, [idx, phases, onDone]);

  const current = phases[Math.min(idx, phases.length - 1)];

  return (
    <div className="flex flex-col items-center gap-8">
      <div
        className="h-48 w-48 sm:h-56 sm:w-56 rounded-full bg-accent/15 border border-accent/30 transition-transform duration-[4000ms] ease-in-out"
        style={{ transform: `scale(${current.scale})` }}
      />
      <p className="text-lg text-muted-foreground tracking-wide">
        {current.label}
      </p>
      <button
        onClick={onDone}
        className="text-xs text-muted-foreground/70 hover:text-foreground"
      >
        Skip
      </button>
    </div>
  );
}
