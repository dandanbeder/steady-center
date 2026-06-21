import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Mail,
  Monitor,
  Sun,
  Moon,
  Sparkles,
  CalendarClock,
  Megaphone,
  ListChecks,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
  type PerTypeChannels,
} from "@/lib/user-prefs";
import { getMarketingOptIn, setMarketingOptIn } from "@/lib/email-prefs.functions";

type TypeKey = keyof PerTypeChannels;

export function NotificationsPanel() {
  const qc = useQueryClient();
  const fetchOptIn = useServerFn(getMarketingOptIn);
  const updateOptIn = useServerFn(setMarketingOptIn);
  const optInQ = useQuery({
    queryKey: ["marketing-opt-in"],
    queryFn: () => fetchOptIn(),
  });
  const optInM = useMutation({
    mutationFn: (v: boolean) => updateOptIn({ data: { optedIn: v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing-opt-in"] });
      toast.success("Email preferences updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: getNotificationPrefs,
  });
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => saveNotificationPrefs(draft!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      toast.success("Notification preferences saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const setChannel = (k: keyof NotificationPrefs["channels"], v: boolean) =>
    setDraft({ ...draft, channels: { ...draft.channels, [k]: v } });
  const setEvent = <K extends keyof NotificationPrefs["events"]>(
    k: K,
    v: NotificationPrefs["events"][K],
  ) => setDraft({ ...draft, events: { ...draft.events, [k]: v } });
  const setTypeChannel = (type: TypeKey, ch: "email" | "browser", v: boolean) =>
    setDraft({
      ...draft,
      events: {
        ...draft.events,
        type_channels: {
          ...draft.events.type_channels,
          [type]: { ...draft.events.type_channels[type], [ch]: v },
        },
      },
    });

  const requestBrowserPerm = async () => {
    if (typeof Notification === "undefined") {
      toast.error("This browser doesn't support notifications, in-app bell will be used instead");
      setChannel("browser", true);
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setChannel("browser", true);
        toast.success("Browser push enabled");
      } else {
        setChannel("browser", true);
        toast.message("Push permission denied, falling back to the in-app bell");
      }
    } catch {
      setChannel("browser", true);
      toast.message("Couldn't request push permission, in-app bell will still work");
    }
  };

  return (
    <div className="space-y-6">
      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Channels
          </CardTitle>
          <CardDescription>Choose how Heartbeat reaches you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RowToggle
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            description="Sent to the email you signed in with."
            checked={draft.channels.email}
            onChange={(v) => setChannel("email", v)}
          />
          <RowToggle
            icon={<Monitor className="h-4 w-4" />}
            label="Browser"
            description="In-app notifications, plus optional browser push when this device allows it. If push is denied we fall back to the in-app bell."
            checked={draft.channels.browser}
            onChange={(v) => {
              if (v) void requestBrowserPerm();
              else setChannel("browser", false);
            }}
          />
        </CardContent>
      </Card>

      {/* What to notify me about */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> What to notify me about
          </CardTitle>
          <CardDescription>Pick the types you care about, and which channels deliver them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TypeRow
            label="Event reminders"
            helper="A nudge before scheduled events on your calendar."
            enabled={draft.events.event_reminders}
            onEnabledChange={(v) => setEvent("event_reminders", v)}
            channels={draft.events.type_channels.event_reminders}
            onChannelChange={(c, v) => setTypeChannel("event_reminders", c, v)}
            extra={
              draft.events.event_reminders && (
                <div className="flex items-center gap-2 text-sm pt-1">
                  <span className="text-muted-foreground">Lead time:</span>
                  <Select
                    value={String(draft.events.event_reminder_lead_minutes)}
                    onValueChange={(v) => setEvent("event_reminder_lead_minutes", Number(v))}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 30, 60, 120].map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m < 60 ? `${m} min` : `${m / 60} hr`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            }
          />
          <TypeRow
            label="Task due reminders"
            helper="A heads-up when a task is approaching its due date."
            enabled={draft.events.task_due}
            onEnabledChange={(v) => setEvent("task_due", v)}
            channels={draft.events.type_channels.task_due}
            onChannelChange={(c, v) => setTypeChannel("task_due", c, v)}
          />
          <TypeRow
            label="Weekly review"
            helper="Your gentle Friday recap, what landed, what's next."
            enabled={draft.events.weekly_review}
            onEnabledChange={(v) => setEvent("weekly_review", v)}
            channels={draft.events.type_channels.weekly_review}
            onChannelChange={(c, v) => setTypeChannel("weekly_review", c, v)}
          />
          <TypeRow
            label="Meeting summary ready"
            helper="We'll tell you when a meeting's notes, decisions, and actions are ready."
            enabled={draft.events.meeting_summary_ready}
            onEnabledChange={(v) => setEvent("meeting_summary_ready", v)}
            channels={draft.events.type_channels.meeting_summary_ready}
            onChannelChange={(c, v) => setTypeChannel("meeting_summary_ready", c, v)}
          />
          <TypeRow
            label="When someone tags me"
            helper="In a comment, note, or shared item."
            enabled={draft.events.tagged}
            onEnabledChange={(v) => setEvent("tagged", v)}
            channels={draft.events.type_channels.tagged}
            onChannelChange={(c, v) => setTypeChannel("tagged", c, v)}
          />
        </CardContent>
      </Card>

      {/* Daily Pulse */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Daily Pulse
          </CardTitle>
          <CardDescription>
            Morning brief and evening wind-down on Today. Times are in your timezone and respect Quiet hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RowToggle
            icon={<Sun className="h-4 w-4" />}
            label="Morning pulse"
            description="Calm daily brief, meetings, Focus 3, load vs capacity, anything at risk."
            checked={draft.events.morning_pulse_enabled}
            onChange={(v) => setEvent("morning_pulse_enabled", v)}
          />
          {draft.events.morning_pulse_enabled && (
            <div className="pl-7 grid grid-cols-2 gap-4">
              <TimePicker
                label="Time"
                hour={draft.events.morning_pulse_hour}
                minute={draft.events.morning_pulse_minute}
                onChange={(h, m) =>
                  setDraft({ ...draft, events: { ...draft.events, morning_pulse_hour: h, morning_pulse_minute: m } })
                }
              />
              <div className="flex items-end">
                <RowToggle
                  label="Email it"
                  description="Also send the brief to your inbox."
                  checked={draft.events.morning_pulse_email}
                  onChange={(v) => setEvent("morning_pulse_email", v)}
                />
              </div>
            </div>
          )}
          <RowToggle
            icon={<Moon className="h-4 w-4" />}
            label="Evening wind-down"
            description="A 2-minute ritual, review today, set tomorrow's Focus 3, breathe."
            checked={draft.events.evening_winddown_enabled}
            onChange={(v) => setEvent("evening_winddown_enabled", v)}
          />
          {draft.events.evening_winddown_enabled && (
            <div className="pl-7">
              <TimePicker
                label="Time"
                hour={draft.events.evening_winddown_hour}
                minute={draft.events.evening_winddown_minute}
                onChange={(h, m) =>
                  setDraft({ ...draft, events: { ...draft.events, evening_winddown_hour: h, evening_winddown_minute: m } })
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quiet hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="h-4 w-4" /> Quiet hours
          </CardTitle>
          <CardDescription>Suppress non-critical notifications during this window.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RowToggle
            label="Enable quiet hours"
            description="We'll hold non-urgent pings until your day starts again."
            checked={draft.quiet_enabled}
            onChange={(v) => setDraft({ ...draft, quiet_enabled: v })}
          />
          {draft.quiet_enabled && (
            <div className="grid grid-cols-2 gap-4">
              <HourPicker label="From" value={draft.quiet_start} onChange={(v) => setDraft({ ...draft, quiet_start: v })} />
              <HourPicker label="Until" value={draft.quiet_end} onChange={(v) => setDraft({ ...draft, quiet_end: v })} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meeting reminders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Meeting reminders
          </CardTitle>
          <CardDescription>
            Meetings always get a 15-minute and 5-minute reminder on your selected channels. Optionally add one extra earlier reminder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Extra earlier reminder:</span>
            <Select
              value={draft.events.meeting_extra_lead_minutes === null
                ? "none"
                : String(draft.events.meeting_extra_lead_minutes)}
              onValueChange={(v) =>
                setEvent("meeting_extra_lead_minutes", v === "none" ? null : Number(v))
              }
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (15 and 5 only)</SelectItem>
                {[30, 60, 120, 1440].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m < 60 ? `${m} min before` : m < 1440 ? `${m / 60} hr before` : "1 day before"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RowToggle
            label="Deliver during Quiet hours"
            description="Meetings are time-critical, keep this on so you never miss one."
            checked={draft.events.meeting_quiet_hours_bypass}
            onChange={(v) => setEvent("meeting_quiet_hours_bypass", v)}
          />
        </CardContent>
      </Card>

      {/* Product updates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" /> Product updates
          </CardTitle>
          <CardDescription>
            Occasional emails about new features and tips. Account, security, and billing messages are always sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RowToggle
            label="Send me product updates"
            description="You can unsubscribe at any time."
            checked={optInQ.data?.optedIn ?? false}
            onChange={(v) => optInM.mutate(v)}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}

function RowToggle({
  label,
  description,
  checked,
  onChange,
  icon,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex items-start gap-3">
        {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={`${label}, ${checked ? "on" : "off"}`}
      />
    </div>
  );
}

function TypeRow({
  label,
  helper,
  enabled,
  onEnabledChange,
  channels,
  onChannelChange,
  extra,
}: {
  label: string;
  helper: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  channels: { email: boolean; browser: boolean };
  onChannelChange: (c: "email" | "browser", v: boolean) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{helper}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label={`${label}, ${enabled ? "on" : "off"}`} />
      </div>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground mr-1">Deliver via:</span>
          <ChannelChip label="Email" icon={<Mail className="h-3 w-3" />} active={channels.email} onChange={(v) => onChannelChange("email", v)} />
          <ChannelChip label="Browser" icon={<Monitor className="h-3 w-3" />} active={channels.browser} onChange={(v) => onChannelChange("browser", v)} />
          {!channels.email && !channels.browser && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Pick at least one channel.</span>
          )}
        </div>
      )}
      {extra}
    </div>
  );
}

function ChannelChip({
  label,
  icon,
  active,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
        (active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function HourPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-72">
          {Array.from({ length: 24 }, (_, i) => (
            <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TimePicker({ label, hour, minute, onChange }: { label: string; hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <div className="flex gap-2">
        <Select value={String(hour)} onValueChange={(v) => onChange(Number(v), minute)}>
          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {Array.from({ length: 24 }, (_, i) => (
              <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(minute)} onValueChange={(v) => onChange(hour, Number(v))}>
          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[0, 15, 30, 45].map((m) => (
              <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export type { NotificationPrefs };
