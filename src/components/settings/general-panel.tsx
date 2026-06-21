import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { User as UserIcon } from "lucide-react";
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
import {
  getGeneralPrefs,
  updateGeneralPrefs,
  type DefaultLanding,
  type HourFormat,
  type WeekStartDay,
} from "@/lib/general-prefs";
import { listTimezones } from "@/lib/weekly-reports";
import { ChangePasswordSection } from "@/components/settings/change-password-section";

export function GeneralPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["general-prefs"],
    queryFn: getGeneralPrefs,
  });

  const [name, setName] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [hour, setHour] = useState<HourFormat | null>(null);
  const [wsd, setWsd] = useState<WeekStartDay | null>(null);
  const [landing, setLanding] = useState<DefaultLanding | null>(null);

  // Reset local edits when freshly-loaded data arrives.
  useEffect(() => {
    if (!data) return;
    setName(null);
    setTz(null);
    setHour(null);
    setWsd(null);
    setLanding(null);
  }, [data?.full_name, data?.timezone, data?.hour_format, data?.week_start_day, data?.default_landing]);

  const timezones = useMemo(() => listTimezones(), []);

  const save = useMutation({
    mutationFn: () =>
      updateGeneralPrefs({
        full_name: name ?? data!.full_name,
        timezone: tz ?? data!.timezone,
        hour_format: hour ?? data!.hour_format,
        week_start_day: wsd ?? data!.week_start_day,
        default_landing: landing ?? data!.default_landing,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["general-prefs"] });
      qc.invalidateQueries({ queryKey: ["weekly-review-prefs"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const initials = (data.full_name || data.email || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const nameVal = name ?? data.full_name;
  const tzVal = tz ?? data.timezone;
  const hourVal = hour ?? data.hour_format;
  const wsdVal = wsd ?? data.week_start_day;
  const landingVal = landing ?? data.default_landing;

  const dirty =
    nameVal !== data.full_name ||
    tzVal !== data.timezone ||
    hourVal !== data.hour_format ||
    wsdVal !== data.week_start_day ||
    landingVal !== data.default_landing;

  return (
    <div className="space-y-8">
      {/* Profile */}
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-medium border border-border">
            {initials || <UserIcon className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Signed in as</p>
            <p className="text-sm truncate">{data.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">
              Display name
            </Label>
            <Input
              id="name"
              value={nameVal}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
            <Input value={data.email} readOnly disabled className="mt-1" />
          </div>
        </div>
      </section>

      {/* Locale & formats */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Global timezone</h3>
          <p className="text-xs text-muted-foreground">
            Drives the Calendar, reminders, weekly review, and daily pulses.
          </p>
        </div>
        <Select value={tzVal} onValueChange={(v) => setTz(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {timezones.map((z) => (
              <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time format</Label>
            <Select value={hourVal} onValueChange={(v) => setHour(v as HourFormat)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-hour (14:30)</SelectItem>
                <SelectItem value="12h">12-hour (2:30 PM)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Week starts on</Label>
            <Select
              value={String(wsdVal)}
              onValueChange={(v) => setWsd(Number(v) as WeekStartDay)}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="0">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Default landing page</Label>
            <Select
              value={landingVal}
              onValueChange={(v) => setLanding(v as DefaultLanding)}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="calendar">Calendar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </section>

      {/* Password */}
      <section className="pt-2 border-t border-border">
        <h3 className="text-sm font-medium mb-3">Password</h3>
        <ChangePasswordSection />
      </section>
    </div>
  );
}
