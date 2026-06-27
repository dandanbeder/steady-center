import { useMemo, useState } from "react";
import * as chrono from "chrono-node";
import { Sparkles, Loader2, Calendar as CalIcon, ListChecks, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createEvent, type Calendar as Cal } from "@/lib/calendars";
import { createTask, listLists, listFolders } from "@/lib/tasks";
import { listBusinesses } from "@/lib/businesses";
import { processMeeting } from "@/lib/meetings.functions";
import {
  interpretQuickAdd,
  type QuickAddSuggestion,
} from "@/lib/quick-add-ai.functions";

type EntityType = "event" | "task" | "meeting";

/**
 * Quick-add bar: AI-invoked natural-language creation.
 * Press Enter or click "Add" → instant chrono-based event create (back-compat fast path).
 * Click ✨ AI → call AI to classify event/task/meeting, then confirm before saving.
 */
export function QuickAddBar({
  calendars,
  defaultCalendarId,
  onCreated,
}: {
  calendars: Cal[];
  defaultCalendarId: string | null;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [calId, setCalId] = useState<string>(defaultCalendarId ?? calendars[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [preview, setPreview] = useState<QuickAddSuggestion | null>(null);

  const parsed = parse(text);
  const interpret = useServerFn(interpretQuickAdd);

  async function submit() {
    if (!text.trim()) return;
    if (!calId) {
      toast.error("Pick a calendar first");
      return;
    }
    const result = parse(text);
    if (!result) {
      toast.error("Couldn't read a date or time, try ✨ AI, or 'Coffee tomorrow 9am'");
      return;
    }
    const cal = calendars.find((c) => c.id === calId) ?? null;
    setBusy(true);
    try {
      const r = await createEvent({
        calendar_id: calId,
        business_id: cal?.business_id ?? null,
        title: result.title,
        start_at: result.start.toISOString(),
        end_at: result.end.toISOString(),
        all_day: result.allDay,
      });
      setText("");
      onCreated();
      if (r.syncWarning) toast.warning(r.syncWarning);
      else toast.success(`Added "${result.title}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add event");
    } finally {
      setBusy(false);
    }
  }

  async function runAi() {
    if (!text.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const suggestion = await interpret({
        data: {
          text: text.trim(),
          now: new Date().toISOString(),
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ?? undefined,
        },
      });
      setPreview(suggestion);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI couldn't read that";
      toast.error(`${msg}, pick the type manually`);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-2.5 mb-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <Sparkles className="h-4 w-4 text-accent shrink-0 hidden sm:block" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder='Quick add, "Coffee Sam Fri 9am", "Zoom Acme Tue", "email accountant"'
          className="flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 sm:px-2"
        />
        <div className="flex items-center gap-2">
          {calendars.length > 1 && (
            <Select value={calId} onValueChange={setCalId}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={runAi}
            disabled={aiBusy || !text.trim()}
            title="Interpret with AI (event, task, or meeting)"
          >
            {aiBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> AI
              </>
            )}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
          </Button>
        </div>
        {parsed && (
          <div className="basis-full sm:basis-auto text-[11px] text-muted-foreground sm:ml-2">
            {previewLabel(parsed)}
          </div>
        )}
      </div>

      {preview && (
        <ConfirmDialog
          suggestion={preview}
          rawText={text}
          calendars={calendars}
          defaultCalendarId={calId}
          onClose={() => setPreview(null)}
          onCreated={() => {
            setPreview(null);
            setText("");
            onCreated();
          }}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  suggestion,
  rawText,
  calendars,
  defaultCalendarId,
  onClose,
  onCreated,
}: {
  suggestion: QuickAddSuggestion;
  rawText: string;
  calendars: Cal[];
  defaultCalendarId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const runMeeting = useServerFn(processMeeting);
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });

  const [type, setType] = useState<EntityType>(suggestion.type);
  const [title, setTitle] = useState(suggestion.title);
  const [businessId, setBusinessId] = useState<string | null>(
    suggestion.business_id ?? null,
  );
  const [calId, setCalId] = useState<string>(defaultCalendarId);
  const [startLocal, setStartLocal] = useState(
    suggestion.start_at ? toLocalInput(suggestion.start_at) : "",
  );
  const [endLocal, setEndLocal] = useState(
    suggestion.end_at ? toLocalInput(suggestion.end_at) : "",
  );
  const [allDay, setAllDay] = useState<boolean>(suggestion.all_day ?? false);
  const [busy, setBusy] = useState(false);

  const folderBiz = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const f of folders) m.set(f.id, f.business_id ?? null);
    return m;
  }, [folders]);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Add a title");
      return;
    }
    setBusy(true);
    try {
      if (type === "task") {
        const due = startLocal ? new Date(startLocal).toISOString() : null;
        const matchList = lists.find((l) =>
          businessId == null
            ? folderBiz.get(l.folder_id) == null
            : folderBiz.get(l.folder_id) === businessId,
        );
        await createTask({
          list_id: matchList?.id ?? null,
          business_id: businessId,
          title: title.trim(),
          priority: suggestion.priority ?? "normal",
          due_at: due,
        });
        toast.success(`Task added, "${title.trim()}"`);
        qc.invalidateQueries({ queryKey: ["tasks"] });
        onCreated();
      } else if (type === "event") {
        if (!calId) throw new Error("Pick a calendar");
        if (!startLocal) throw new Error("Pick a start time");
        const cal = calendars.find((c) => c.id === calId) ?? null;
        const start = new Date(startLocal);
        const end = endLocal ? new Date(endLocal) : new Date(start.getTime() + 60 * 60_000);
        const r = await createEvent({
          calendar_id: calId,
          business_id: cal?.business_id ?? businessId,
          title: title.trim(),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          all_day: allDay,
        });
        qc.invalidateQueries({ queryKey: ["events"] });
        if (r.syncWarning) toast.warning(r.syncWarning);
        else toast.success(`Event added, "${title.trim()}"`);
        onCreated();
      } else {
        // meeting
        const { detectPlatformFromUrl } = await import("@/lib/meeting-platform");
        const join = suggestion.join_url ?? null;
        const platform = join ? detectPlatformFromUrl(join).id : "other";
        const res = await runMeeting({
          data: {
            title: title.trim(),
            platform,
            join_url: join,
            business_id: businessId,
            mode: "note",
          },
        });
        qc.invalidateQueries({ queryKey: ["meetings"] });
        toast.success(`Meeting added, "${title.trim()}"`);
        onCreated();
        navigate({ to: "/meetings/$meetingId", params: { meetingId: res.meeting_id } });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !busy && !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Confirm what to create
          </DialogTitle>
          <DialogDescription className="text-xs">
            From "{rawText}"
            {suggestion.reasoning ? `, ${suggestion.reasoning}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Type</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(["event", "task", "meeting"] as EntityType[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setType(t)}
                  className="capitalize"
                >
                  {t === "event" && <CalIcon className="h-3.5 w-3.5 mr-1" />}
                  {t === "task" && <ListChecks className="h-3.5 w-3.5 mr-1" />}
                  {t === "meeting" && <Users className="h-3.5 w-3.5 mr-1" />}
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {type === "event" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">End</Label>
                  <Input
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
                All day
              </label>
              {calendars.length > 1 && (
                <div>
                  <Label className="text-xs">Calendar</Label>
                  <Select value={calId} onValueChange={setCalId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {type === "task" && (
            <div>
              <Label className="text-xs">Due (optional)</Label>
              <Input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
          )}

          {type !== "event" && (
            <div>
              <Label className="text-xs">Account</Label>
              <Select
                value={businessId ?? "_personal"}
                onValueChange={(v) =>
                  setBusinessId(v === "_personal" ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_personal">Personal</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "meeting" && suggestion.join_url && (
            <div className="text-xs text-muted-foreground break-all">
              Join link: {suggestion.join_url}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `Create ${type}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Parsed = { title: string; start: Date; end: Date; allDay: boolean };

function parse(input: string): Parsed | null {
  const text = input.trim();
  if (!text) return null;
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length === 0) return null;
  const r = results[0];
  const start = r.start.date();
  const hasHour = r.start.isCertain("hour") || r.start.isCertain("minute");
  let end: Date;
  if (r.end) {
    end = r.end.date();
  } else if (hasHour) {
    const dur = text.match(/for\s+(\d+)\s*(min|mins|minutes|h|hr|hour|hours)\b/i);
    if (dur) {
      const n = parseInt(dur[1], 10);
      const unit = dur[2].toLowerCase();
      const mins = unit.startsWith("h") ? n * 60 : n;
      end = new Date(start.getTime() + mins * 60_000);
    } else {
      end = new Date(start.getTime() + 60 * 60_000);
    }
  } else {
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  }
  const matched = r.text;
  let title = text.replace(matched, "").replace(/\s+/g, " ").trim();
  title = title.replace(/\b(at|on|from|for)\b\s*$/i, "").trim();
  if (!title) title = "Untitled";
  return { title, start, end, allDay: !hasHour };
}

function previewLabel(p: Parsed) {
  const sameDay = p.start.toDateString() === p.end.toDateString();
  const dateStr = p.start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (p.allDay) return `→ ${p.title} · ${dateStr} (all day)`;
  const t = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const range = sameDay
    ? `${t(p.start)}–${t(p.end)}`
    : `${t(p.start)} → ${p.end.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${t(p.end)}`;
  return `→ ${p.title} · ${dateStr} ${range}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
