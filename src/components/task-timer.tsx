import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square, Plus, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatMinutes,
  getRunningTimer,
  listEntriesForTask,
  listTaskMinutes,
  listTaskMinutesThisWeek,
  logManualMinutes,
  startTimer,
  stopTimer,
  type TimeEntry,
} from "@/lib/time-entries";
import { cn } from "@/lib/utils";

function useTickWhile(running: boolean, ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [running, ms]);
}

/** Compact inline timer + quick log used on a task row. */
export function TaskTimerInline({
  taskId,
  businessId,
  className,
}: {
  taskId: string;
  businessId: string | null;
  className?: string;
}) {
  const qc = useQueryClient();
  const { data: running } = useQuery({
    queryKey: ["time-running"],
    queryFn: getRunningTimer,
    refetchInterval: 30_000,
  });
  const { data: weekTotals = {} } = useQuery({
    queryKey: ["time-week-totals"],
    queryFn: listTaskMinutesThisWeek,
    refetchInterval: 60_000,
  });

  const isThisTaskRunning = running?.task_id === taskId;
  useTickWhile(isThisTaskRunning);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["time-running"] });
    qc.invalidateQueries({ queryKey: ["time-week-totals"] });
    qc.invalidateQueries({ queryKey: ["time-task-totals"] });
    qc.invalidateQueries({ queryKey: ["time-entries", taskId] });
  };

  const start = useMutation({
    mutationFn: () => startTimer({ id: taskId, business_id: businessId }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const stop = useMutation({
    mutationFn: () => stopTimer(running!),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const log = useMutation({
    mutationFn: (minutes: number) =>
      logManualMinutes({ task_id: taskId, business_id: businessId, minutes }),
    onSuccess: () => {
      invalidate();
      toast.success("Time logged");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  let weekMin = weekTotals[taskId] ?? 0;
  if (isThisTaskRunning && running) {
    weekMin += Math.max(0, Math.round((Date.now() - +new Date(running.started_at)) / 60000));
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      onClick={(e) => e.stopPropagation()}
    >
      {weekMin > 0 && (
        <span
          title="Tracked this week"
          className="text-[11px] text-muted-foreground flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/40"
        >
          <Clock className="h-3 w-3" />
          {formatMinutes(weekMin)}
        </span>
      )}
      <Button
        size="icon"
        variant={isThisTaskRunning ? "default" : "ghost"}
        className="h-7 w-7"
        title={isThisTaskRunning ? "Stop timer" : "Start timer"}
        onClick={() => (isThisTaskRunning ? stop.mutate() : start.mutate())}
        disabled={start.isPending || stop.isPending}
      >
        {isThisTaskRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <ManualLogPopover onLog={(m) => log.mutate(m)} />
    </div>
  );
}

function ManualLogPopover({ onLog }: { onLog: (minutes: number) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const submitCustom = () => {
    const n = parseInt(custom, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    onLog(n);
    setCustom("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Log time">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="flex gap-1 mb-2">
          {[15, 30, 60].map((m) => (
            <Button
              key={m}
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                onLog(m);
                setOpen(false);
              }}
            >
              +{m}m
            </Button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCustom();
          }}
          className="flex gap-1"
        >
          <Input
            type="number"
            min={1}
            placeholder="Minutes"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Full panel for the task detail dialog: total + recent entries + controls. */
export function TaskTimePanel({
  taskId,
  businessId,
}: {
  taskId: string;
  businessId: string | null;
}) {
  const { data: totals = {} } = useQuery({
    queryKey: ["time-task-totals"],
    queryFn: listTaskMinutes,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["time-entries", taskId],
    queryFn: () => listEntriesForTask(taskId),
  });
  const { data: running } = useQuery({
    queryKey: ["time-running"],
    queryFn: getRunningTimer,
    refetchInterval: 30_000,
  });

  const isThisRunning = running?.task_id === taskId;
  useTickWhile(isThisRunning);

  let total = totals[taskId] ?? 0;
  if (isThisRunning && running) {
    total += Math.max(0, Math.round((Date.now() - +new Date(running.started_at)) / 60000));
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Time tracked
        </div>
        <div className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          {formatMinutes(total)}
          {isThisRunning && (
            <span className="text-[10px] uppercase text-accent">live</span>
          )}
        </div>
      </div>
      <TaskTimerInline taskId={taskId} businessId={businessId} className="justify-start" />
      {entries.length > 0 && (
        <ul className="text-xs divide-y divide-border max-h-40 overflow-auto">
          {entries.slice(0, 20).map((e: TimeEntry) => (
            <li key={e.id} className="py-1.5 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {new Date(e.started_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="ml-1 text-foreground/40">· {e.source}</span>
              </span>
              <span>{e.ended_at ? formatMinutes(e.minutes) : "running…"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
