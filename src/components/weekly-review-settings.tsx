import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  getWeeklyReviewPrefs,
  nextScheduledRun,
  updateWeeklyReviewPrefs,
  WEEKDAYS,
} from "@/lib/weekly-reports";

const PRESET_STEP_MIN = 30;

function fmt(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseHHMM(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function WeeklyReviewSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["weekly-review-prefs"],
    queryFn: getWeeklyReviewPrefs,
  });

  const [day, setDay] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [manual, setManual] = useState<string>("");
  const [manualError, setManualError] = useState<string | null>(null);

  const d = day ?? data?.weekly_review_day ?? 5;
  const h = hour ?? data?.weekly_review_hour ?? 16;
  const mn = minute ?? data?.weekly_review_minute ?? 0;
  const en = enabled ?? data?.weekly_review_enabled ?? true;
  const zone = data?.timezone ?? "Africa/Johannesburg";

  // Keep manual input in sync with the active selection.
  useEffect(() => {
    setManual(fmt(h, mn));
    setManualError(null);
  }, [h, mn]);

  const presetOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let hr = 0; hr < 24; hr++) {
      for (let mm = 0; mm < 60; mm += PRESET_STEP_MIN) {
        const v = fmt(hr, mm);
        out.push({ value: v, label: v });
      }
    }
    return out;
  }, []);

  const presetValue = fmt(h, mn);
  // If current selection isn't on a 30-min boundary (manual time), inject it.
  const presetItems = useMemo(() => {
    if (presetOptions.some((o) => o.value === presetValue)) return presetOptions;
    return [...presetOptions, { value: presetValue, label: `${presetValue} (custom)` }].sort(
      (a, b) => a.value.localeCompare(b.value),
    );
  }, [presetOptions, presetValue]);

  const next = useMemo(
    () =>
      nextScheduledRun({
        weekly_review_day: d,
        weekly_review_hour: h,
        weekly_review_minute: mn,
        weekly_review_enabled: en,
        timezone: zone,
      }),
    [d, h, mn, en, zone],
  );

  const save = useMutation({
    mutationFn: () => {
      // Re-validate manual input on save so a stale invalid entry can't sneak through.
      const parsed = parseHHMM(manual);
      if (!parsed) throw new Error("Enter a valid 24-hour time, like 07:30 or 16:45.");
      return updateWeeklyReviewPrefs({
        weekly_review_day: d,
        weekly_review_hour: parsed.hour,
        weekly_review_minute: parsed.minute,
        weekly_review_enabled: en,
        timezone: zone,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly-review-prefs"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Weekly review email</p>
          <p className="text-xs text-muted-foreground">
            Automatic summary of your week, delivered to your inbox.
          </p>
        </div>
        <Switch checked={en} onCheckedChange={(v) => setEnabled(v)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">
            Day
          </Label>
          <Select value={String(d)} onValueChange={(v) => setDay(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((label, i) => (
                <SelectItem key={i} value={String(i)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">
            Time (local, 24h)
          </Label>
          <Select
            value={presetValue}
            onValueChange={(v) => {
              const p = parseHHMM(v);
              if (!p) return;
              setHour(p.hour);
              setMinute(p.minute);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {presetItems.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="weekly-review-manual" className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">
          Or enter an exact time
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="weekly-review-manual"
            type="time"
            step={60}
            value={manual}
            onChange={(e) => {
              const v = e.target.value;
              setManual(v);
              const p = parseHHMM(v);
              if (!p) {
                setManualError("Enter a valid 24-hour time, like 07:30 or 16:45.");
                return;
              }
              setManualError(null);
              setHour(p.hour);
              setMinute(p.minute);
            }}
            className="w-40"
          />
          <p className="text-xs text-muted-foreground">
            24-hour time in your local timezone.
          </p>
        </div>
        {manualError ? (
          <p className="text-xs text-destructive mt-1">{manualError}</p>
        ) : null}
      </div>

      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Next scheduled run
        </p>
        {en && next ? (
          <>
            <p>
              {next.toLocaleString(undefined, {
                timeZone: zone,
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}{" "}
              <span className="text-muted-foreground">({zone})</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {next.toUTCString()}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Disabled</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          Timezone is set in <span className="font-medium">General, Global timezone</span>.
        </p>
      </div>

      <Button
        onClick={() => save.mutate()}
        disabled={save.isPending || !!manualError}
      >
        Save schedule
      </Button>
    </div>
  );
}
