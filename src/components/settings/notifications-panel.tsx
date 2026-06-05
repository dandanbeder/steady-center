import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Megaphone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
} from "@/lib/user-prefs";
import { getMarketingOptIn, setMarketingOptIn } from "@/lib/email-prefs.functions";

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

  const requestBrowserPerm = async () => {
    if (typeof Notification === "undefined") {
      toast.error("This browser doesn't support notifications");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setChannel("browser", true);
      toast.success("Browser notifications enabled");
    } else {
      toast.error("Browser denied notification permission");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Bell className="h-4 w-4" /> Channels
        </h3>
        <div className="space-y-2">
          <RowToggle
            label="Email"
            description="Sent via Resend to your account email"
            checked={draft.channels.email}
            onChange={(v) => setChannel("email", v)}
          />
          <RowToggle
            label="SMS"
            description="Sent via Twilio to your phone number (add one in your profile)"
            checked={draft.channels.sms}
            onChange={(v) => setChannel("sms", v)}
          />
          <RowToggle
            label="Browser"
            description="In-browser push notifications"
            checked={draft.channels.browser}
            onChange={(v) => {
              if (v) void requestBrowserPerm();
              else setChannel("browser", false);
            }}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">What to notify me about</h3>
        <div className="space-y-2">
          <RowToggle
            label="Event reminders"
            checked={draft.events.event_reminders}
            onChange={(v) => setEvent("event_reminders", v)}
          />
          {draft.events.event_reminders && (
            <div className="pl-4 flex items-center gap-2 text-sm">
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
          )}
          <RowToggle label="Task due reminders" checked={draft.events.task_due} onChange={(v) => setEvent("task_due", v)} />
          <RowToggle label="Weekly review" checked={draft.events.weekly_review} onChange={(v) => setEvent("weekly_review", v)} />
          <RowToggle label="Meeting summary ready" checked={draft.events.meeting_summary_ready} onChange={(v) => setEvent("meeting_summary_ready", v)} />
          <RowToggle label="When someone tags me" checked={draft.events.tagged} onChange={(v) => setEvent("tagged", v)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Daily Pulse</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Morning brief and evening wind-down on Today. Times are in your timezone and respect Quiet hours.
        </p>
        <div className="space-y-3">
          <RowToggle
            label="Morning pulse"
            description="Calm daily brief — meetings, Focus 3, load vs capacity, anything at risk"
            checked={draft.events.morning_pulse_enabled}
            onChange={(v) => setEvent("morning_pulse_enabled", v)}
          />
          {draft.events.morning_pulse_enabled && (
            <div className="pl-4 grid grid-cols-2 gap-3">
              <TimePicker
                label="Time"
                hour={draft.events.morning_pulse_hour}
                minute={draft.events.morning_pulse_minute}
                onChange={(h, m) => setDraft({ ...draft, events: { ...draft.events, morning_pulse_hour: h, morning_pulse_minute: m } })}
              />
              <div className="flex items-end">
                <RowToggle
                  label="Email it"
                  checked={draft.events.morning_pulse_email}
                  onChange={(v) => setEvent("morning_pulse_email", v)}
                />
              </div>
            </div>
          )}
          <RowToggle
            label="Evening wind-down"
            description="2-minute ritual: review today, set tomorrow's Focus 3, breathe"
            checked={draft.events.evening_winddown_enabled}
            onChange={(v) => setEvent("evening_winddown_enabled", v)}
          />
          {draft.events.evening_winddown_enabled && (
            <div className="pl-4">
              <TimePicker
                label="Time"
                hour={draft.events.evening_winddown_hour}
                minute={draft.events.evening_winddown_minute}
                onChange={(h, m) => setDraft({ ...draft, events: { ...draft.events, evening_winddown_hour: h, evening_winddown_minute: m } })}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Quiet hours</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Suppress non-critical notifications during this window.
        </p>
        <RowToggle
          label="Enable quiet hours"
          checked={draft.quiet_enabled}
          onChange={(v) => setDraft({ ...draft, quiet_enabled: v })}
        />
        {draft.quiet_enabled && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <HourPicker label="From" value={draft.quiet_start} onChange={(v) => setDraft({ ...draft, quiet_start: v })} />
            <HourPicker label="Until" value={draft.quiet_end} onChange={(v) => setDraft({ ...draft, quiet_end: v })} />
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Meeting reminders</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Meetings always get a 15-minute and 5-minute reminder on your selected channels.
          Optionally add one extra earlier reminder.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Extra lead time:</span>
          <Select
            value={draft.events.meeting_extra_lead_minutes === null
              ? "none"
              : String(draft.events.meeting_extra_lead_minutes)}
            onValueChange={(v) =>
              setEvent("meeting_extra_lead_minutes", v === "none" ? null : Number(v))
            }
          >
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (15 & 5 only)</SelectItem>
              {[30, 60, 120, 1440].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m < 60 ? `${m} min before` : m < 1440 ? `${m / 60} hr before` : "1 day before"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3">
          <RowToggle
            label="Deliver during Quiet hours"
            description="Meetings are time-critical — keep this on so you never miss one."
            checked={draft.events.meeting_quiet_hours_bypass}
            onChange={(v) => setEvent("meeting_quiet_hours_bypass", v)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> Product updates
        </h3>
        <RowToggle
          label="Send me product updates"
          description="Occasional emails about new features and tips. Account, security, and billing messages are always sent."
          checked={optInQ.data?.optedIn ?? false}
          onChange={(v) => optInM.mutate(v)}
        />
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );
}

function RowToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
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

// Re-export for typed input usage above
export type { NotificationPrefs };
// Avoid unused import warning if Input isn't otherwise used
void Input;
