import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
  listTimezones,
  nextScheduledRun,
  updateWeeklyReviewPrefs,
  WEEKDAYS,
} from "@/lib/weekly-reports";

export function WeeklyReviewSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["weekly-review-prefs"],
    queryFn: getWeeklyReviewPrefs,
  });

  const [day, setDay] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tz, setTz] = useState<string | null>(null);

  const d = day ?? data?.weekly_review_day ?? 5;
  const h = hour ?? data?.weekly_review_hour ?? 16;
  const en = enabled ?? data?.weekly_review_enabled ?? true;
  const zone = tz ?? data?.timezone ?? "Africa/Johannesburg";

  const timezones = useMemo(() => listTimezones(), []);
  const next = useMemo(
    () =>
      nextScheduledRun({
        weekly_review_day: d,
        weekly_review_hour: h,
        weekly_review_enabled: en,
        timezone: zone,
      }),
    [d, h, en, zone],
  );

  const save = useMutation({
    mutationFn: () =>
      updateWeeklyReviewPrefs({
        weekly_review_day: d,
        weekly_review_hour: h,
        weekly_review_enabled: en,
        timezone: zone,
      }),
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
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Day
          </p>
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
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Time (local)
          </p>
          <Select value={String(h)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {Array.from({ length: 24 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  {String(i).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Timezone
        </p>
        <Select value={zone} onValueChange={(v) => setTz(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {timezones.map((z) => (
              <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Save schedule
      </Button>
    </div>
  );
}
