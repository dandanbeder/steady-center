import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
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
import { getWorkingHours, saveWorkingHours, type WorkingHours } from "@/lib/user-prefs";

const DAYS = [
  { v: 0, label: "Sun" },
  { v: 1, label: "Mon" },
  { v: 2, label: "Tue" },
  { v: 3, label: "Wed" },
  { v: 4, label: "Thu" },
  { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
];

// 15-minute increments across the full day (00:00 → 23:45).
const TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return {
    value: `${h}:${m}`,
    label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
});

export function WorkingHoursPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["working-hours"], queryFn: getWorkingHours });
  const [draft, setDraft] = useState<WorkingHours | null>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => saveWorkingHours(draft!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["working-hours"] });
      toast.success("Working hours saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const toggleDay = (v: number) => {
    const set = new Set(draft.work_days);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    setDraft({ ...draft, work_days: Array.from(set).sort((a, b) => a - b) });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4" /> Working hours
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Start</p>
          <Select
            value={`${draft.work_start_hour}:${draft.work_start_minute}`}
            onValueChange={(v) => {
              const [h, m] = v.split(":").map(Number);
              setDraft({ ...draft, work_start_hour: h, work_start_minute: m });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {TIME_SLOTS.map((s) => (
                <SelectItem key={`s-${s.value}`} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">End</p>
          <Select
            value={`${draft.work_end_hour}:${draft.work_end_minute}`}
            onValueChange={(v) => {
              const [h, m] = v.split(":").map(Number);
              setDraft({ ...draft, work_end_hour: h, work_end_minute: m });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {TIME_SLOTS.map((s) => (
                <SelectItem key={`e-${s.value}`} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Work days</p>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map((d) => {
            const on = draft.work_days.includes(d.v);
            return (
              <button
                key={d.v}
                type="button"
                onClick={() => toggleDay(d.v)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  on
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Daily capacity (hours)
        </p>
        <Input
          type="number"
          min={0}
          max={24}
          step={0.5}
          value={draft.daily_capacity_hours}
          onChange={(e) =>
            setDraft({ ...draft, daily_capacity_hours: Math.max(0, Math.min(24, Number(e.target.value))) })
          }
          className="w-32"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Soft target used by the Today "load" meter and "Plan my day".
        </p>
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save working hours"}
      </Button>
    </div>
  );
}
