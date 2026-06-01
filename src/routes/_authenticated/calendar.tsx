import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  bulkInsertEvents,
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  parseIcs,
  type Calendar as Cal,
  type EventRow,
} from "@/lib/calendars";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar · Heartbeat" }] }),
  component: CalendarPage,
});

type ViewMode = "month" | "week";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function startOfMonthGrid(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function CalendarPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [dayOpen, setDayOpen] = useState<Date | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: calendars = [] } = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });

  const range = useMemo(() => {
    if (view === "month") {
      const start = startOfMonthGrid(cursor);
      return { start, end: addDays(start, 42) };
    }
    const start = startOfWeek(cursor);
    return { start, end: addDays(start, 7) };
  }, [view, cursor]);

  const { data: events = [] } = useQuery({
    queryKey: ["events", range.start.toISOString(), range.end.toISOString()],
    queryFn: () => listEvents(range.start, range.end),
  });

  const visibleCalendars = useMemo(() => {
    return calendars.filter((c) => activeId === ALL || c.business_id === activeId);
  }, [calendars, activeId]);

  const visibleCalIds = useMemo(
    () => new Set(visibleCalendars.filter((c) => !hiddenCals.has(c.id)).map((c) => c.id)),
    [visibleCalendars, hiddenCals],
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => visibleCalIds.has(e.calendar_id)),
    [events, visibleCalIds],
  );

  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  function shift(dir: -1 | 1) {
    if (view === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    } else {
      setCursor(addDays(cursor, dir * 7));
    }
  }

  const title = view === "month"
    ? fmtMonth(cursor)
    : `${startOfWeek(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(startOfWeek(cursor), 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-10 flex flex-col lg:flex-row gap-6 lg:gap-8">
      <div className="flex-1 min-w-0 order-2 lg:order-1">

        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl text-primary">Calendar</h1>
            <p className="text-sm text-muted-foreground mt-1">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView("month")}
                className={cn("px-3 py-1.5 text-sm", view === "month" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >Month</button>
              <button
                onClick={() => setView("week")}
                className={cn("px-3 py-1.5 text-sm", view === "week" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >Week</button>
            </div>
            <Button variant="outline" size="icon" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(startOfDay(new Date()))}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1" /> Import .ics
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} disabled={visibleCalendars.length === 0}>
              <Plus className="h-4 w-4 mr-1" /> New event
            </Button>
          </div>
        </div>

        {view === "month" ? (
          <MonthGrid
            cursor={cursor}
            events={visibleEvents}
            calById={calById}
            onDayClick={(d) => setDayOpen(d)}
          />
        ) : (
          <WeekGrid
            cursor={cursor}
            events={visibleEvents}
            calById={calById}
            onDayClick={(d) => setDayOpen(d)}
          />
        )}
      </div>

      <aside className="w-full lg:w-64 shrink-0 space-y-6 order-1 lg:order-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Calendars</h3>
          {visibleCalendars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calendars yet. Create one in Settings.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visibleCalendars.map((c) => {
                const biz = businesses.find((b) => b.id === c.business_id);
                const on = !hiddenCals.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        const next = new Set(hiddenCals);
                        if (on) next.add(c.id); else next.delete(c.id);
                        setHiddenCals(next);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left"
                    >
                      <span
                        className="h-3 w-3 rounded-sm border"
                        style={{
                          backgroundColor: on ? c.color : "transparent",
                          borderColor: c.color,
                        }}
                      />
                      <span className={cn("text-sm flex-1 truncate", !on && "text-muted-foreground line-through")}>
                        {c.name}
                      </span>
                      {biz && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: biz.color }}
                          title={biz.name}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {dayOpen && (
        <DayAgendaDialog
          date={dayOpen}
          events={visibleEvents.filter((e) => {
            const s = new Date(e.start_at);
            const en = new Date(e.end_at);
            return startOfDay(s) <= dayOpen && startOfDay(en) >= dayOpen;
          })}
          calById={calById}
          onClose={() => setDayOpen(null)}
          onAdd={() => {
            setDayOpen(null);
            setNewOpen(true);
          }}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["events"] })}
        />
      )}

      {newOpen && (
        <NewEventDialog
          defaultDate={dayOpen ?? startOfDay(new Date())}
          calendars={visibleCalendars}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            qc.invalidateQueries({ queryKey: ["events"] });
          }}
        />
      )}

      {importOpen && (
        <ImportIcsDialog
          calendars={visibleCalendars}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ["events"] });
          }}
        />
      )}
    </div>
  );
}

function MonthGrid({
  cursor,
  events,
  calById,
  onDayClick,
}: {
  cursor: Date;
  events: EventRow[];
  calById: Map<string, Cal>;
  onDayClick: (d: Date) => void;
}) {
  const start = startOfMonthGrid(cursor);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="grid grid-cols-7 text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
        {weekdays.map((w) => (
          <div key={w} className="px-2 py-2 text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const dayEvts = events.filter((e) => {
            const s = startOfDay(new Date(e.start_at));
            const en = startOfDay(new Date(e.end_at));
            return s <= d && en >= d;
          });
          return (
            <button
              key={i}
              onClick={() => onDayClick(d)}
              className={cn(
                "min-h-[96px] border-r border-b border-border p-1.5 text-left flex flex-col gap-1 hover:bg-muted/40 transition-colors",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= 35 && "border-b-0",
                !inMonth && "bg-muted/20",
              )}
            >
              <span className={cn(
                "text-xs self-end px-1.5 py-0.5 rounded-full",
                isToday && "bg-accent text-accent-foreground font-semibold",
                !inMonth && "text-muted-foreground",
              )}>
                {d.getDate()}
              </span>
              <div className="space-y-0.5 overflow-hidden">
                {dayEvts.slice(0, 3).map((e) => {
                  const c = calById.get(e.calendar_id);
                  return (
                    <div
                      key={e.id}
                      className="text-[11px] truncate rounded px-1 py-0.5"
                      style={{ backgroundColor: (c?.color ?? "#888") + "22", color: c?.color ?? undefined, borderLeft: `2px solid ${c?.color ?? "#888"}` }}
                    >
                      {!e.all_day && <span className="opacity-70 mr-1">{fmtTime(e.start_at)}</span>}
                      {e.title}
                    </div>
                  );
                })}
                {dayEvts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{dayEvts.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  cursor,
  events,
  calById,
  onDayClick,
}: {
  cursor: Date;
  events: EventRow[];
  calById: Map<string, Cal>;
  onDayClick: (d: Date) => void;
}) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const dayEvts = events
            .filter((e) => {
              const s = startOfDay(new Date(e.start_at));
              const en = startOfDay(new Date(e.end_at));
              return s <= d && en >= d;
            })
            .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
          return (
            <button
              key={d.toISOString()}
              onClick={() => onDayClick(d)}
              className="text-left border-r border-border last:border-r-0 min-h-[420px] flex flex-col hover:bg-muted/30 transition-colors"
            >
              <div className={cn("p-3 border-b border-border", isToday && "bg-accent/10")}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </div>
                <div className={cn("text-2xl mt-1", isToday && "text-accent font-semibold")}>
                  {d.getDate()}
                </div>
              </div>
              <div className="p-2 space-y-1 flex-1">
                {dayEvts.map((e) => {
                  const c = calById.get(e.calendar_id);
                  return (
                    <div
                      key={e.id}
                      className="text-xs rounded px-1.5 py-1"
                      style={{ backgroundColor: (c?.color ?? "#888") + "22", borderLeft: `3px solid ${c?.color ?? "#888"}` }}
                    >
                      {!e.all_day && (
                        <div className="opacity-70 text-[10px]">{fmtTime(e.start_at)}</div>
                      )}
                      <div className="truncate">{e.title}</div>
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayAgendaDialog({
  date,
  events,
  calById,
  onClose,
  onAdd,
  onDeleted,
}: {
  date: Date;
  events: EventRow[];
  calById: Map<string, Cal>;
  onClose: () => void;
  onAdd: () => void;
  onDeleted: () => void;
}) {
  const sorted = [...events].sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
  const del = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      toast.success("Event deleted");
      onDeleted();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-auto">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nothing scheduled.</p>
          ) : (
            sorted.map((e) => {
              const c = calById.get(e.calendar_id);
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border"
                  style={{ borderLeft: `3px solid ${c?.color ?? "#888"}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {e.all_day ? "All day" : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`}
                      {c && <> · {c.name}</>}
                    </div>
                    {e.location && <div className="text-xs text-muted-foreground mt-1">📍 {e.location}</div>}
                    {e.description && <div className="text-sm mt-1 whitespace-pre-wrap">{e.description}</div>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => del.mutate(e.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onAdd}><Plus className="h-4 w-4 mr-1" /> Add event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function NewEventDialog({
  defaultDate,
  calendars,
  onClose,
  onCreated,
}: {
  defaultDate: Date;
  calendars: Cal[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState<string>(calendars[0]?.id ?? "");
  const [date, setDate] = useState(toDateInputValue(defaultDate));
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const cal = calendars.find((c) => c.id === calendarId);
      if (!cal) throw new Error("Pick a calendar");
      let start: Date;
      let end: Date;
      if (allDay) {
        start = new Date(`${date}T00:00:00`);
        end = new Date(`${date}T23:59:59`);
      } else {
        start = new Date(`${date}T${startTime}:00`);
        end = new Date(`${date}T${endTime}:00`);
        if (end <= start) throw new Error("End must be after start");
      }
      await createEvent({
        calendar_id: cal.id,
        business_id: cal.business_id,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: allDay,
      });
    },
    onSuccess: () => {
      toast.success("Event added");
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !calendarId) return;
            mut.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger><SelectValue placeholder="Select calendar" /></SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="allday" checked={allDay} onCheckedChange={(v) => setAllDay(!!v)} />
            <Label htmlFor="allday" className="cursor-pointer">All day</Label>
          </div>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <Label>End</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending || !title.trim() || !calendarId}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportIcsDialog({
  calendars,
  onClose,
  onImported,
}: {
  calendars: Cal[];
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [calendarId, setCalendarId] = useState<string>(calendars[0]?.id ?? "");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseIcs>>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    try {
      const evts = parseIcs(text);
      setParsed(evts);
      setPreviewCount(evts.length);
    } catch {
      toast.error("Could not parse .ics file");
    }
  }

  const mut = useMutation({
    mutationFn: async () => {
      const cal = calendars.find((c) => c.id === calendarId);
      if (!cal) throw new Error("Pick a calendar");
      if (parsed.length === 0) throw new Error("Nothing to import");
      await bulkInsertEvents(
        parsed.map((e) => ({
          calendar_id: cal.id,
          business_id: cal.business_id,
          title: e.title,
          description: e.description,
          location: e.location,
          start_at: e.start_at,
          end_at: e.end_at,
          all_day: e.all_day,
          source: "ics",
          external_id: e.external_id,
        })),
      );
    },
    onSuccess: () => {
      toast.success(`Imported ${parsed.length} events`);
      onImported();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import .ics</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Target calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger><SelectValue placeholder="Select calendar" /></SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>.ics file</Label>
            <Input ref={fileRef} type="file" accept=".ics,text/calendar" onChange={onFile} />
          </div>
          {previewCount !== null && (
            <p className="text-sm text-muted-foreground">
              Found <span className="text-foreground font-medium">{previewCount}</span> events.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !calendarId || parsed.length === 0}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
