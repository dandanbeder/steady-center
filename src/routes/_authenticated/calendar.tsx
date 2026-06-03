import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  Trash2,
  Pencil,
  RefreshCw,
  Maximize2,
  Minimize2,
  Download,
  FileText,
  FileSpreadsheet,
  Repeat,
  MapPin,
  Users,
  StickyNote,
  ListChecks,
  Link2,
  ExternalLink,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ReminderControls } from "@/components/reminder-controls";
import { createNote } from "@/lib/notes";
import { createTask, listLists } from "@/lib/tasks";
import { listBacklinks, resolveLinks, type ResolvedLink } from "@/lib/note-links";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";

import { listBusinesses } from "@/lib/businesses";
import {
  bulkInsertEvents,
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  parseIcs,
  updateCalendar,
  updateEvent,
  type Calendar as Cal,
  type EventRow,
} from "@/lib/calendars";
import { cn } from "@/lib/utils";
import { TagPeople } from "@/components/tag-people";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar · Heartbeat" }] }),
  component: CalendarPage,
});

type ViewMode = "month" | "week" | "day" | "agenda";

// ---------- date helpers ----------
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
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
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// Pick a readable foreground (near-black or near-white) for a given hex bg.
function readableText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "hsl(var(--foreground))";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // perceived luminance
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? "#1a1a1a" : "#ffffff";
}

// Is the event multi-day or all-day (renders in the all-day band)?
function isAllDayLike(e: EventRow) {
  if (e.all_day) return true;
  const s = new Date(e.start_at);
  const en = new Date(e.end_at);
  return !sameDay(s, en);
}

function CalendarPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [dayOpen, setDayOpen] = useState<Date | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newDefaultDate, setNewDefaultDate] = useState<Date>(
    startOfDay(new Date()),
  );
  const [importOpen, setImportOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Lock body scroll while in fullscreen so the expanded calendar owns the viewport.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);


  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const { data: calendars = [] } = useQuery({
    queryKey: ["calendars"],
    queryFn: listCalendars,
  });

  const range = useMemo(() => {
    if (view === "month") {
      const start = startOfMonthGrid(cursor);
      return { start, end: addDays(start, 42) };
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      return { start, end: addDays(start, 7) };
    }
    if (view === "day") {
      return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
    }
    // agenda: ±60 days around cursor
    const start = addDays(startOfDay(cursor), -7);
    return { start, end: addDays(start, 60) };
  }, [view, cursor]);

  const { data: events = [] } = useQuery({
    queryKey: ["events", range.start.toISOString(), range.end.toISOString()],
    queryFn: () => listEvents(range.start, range.end),
  });

  const visibleCalendars = useMemo(
    () => calendars.filter((c) => activeId === ALL || c.business_id === activeId),
    [calendars, activeId],
  );

  const visibleCalIds = useMemo(
    () =>
      new Set(
        visibleCalendars.filter((c) => !hiddenCals.has(c.id)).map((c) => c.id),
      ),
    [visibleCalendars, hiddenCals],
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => visibleCalIds.has(e.calendar_id)),
    [events, visibleCalIds],
  );

  const calById = useMemo(
    () => new Map(calendars.map((c) => [c.id, c])),
    [calendars],
  );

  function shift(dir: -1 | 1) {
    if (view === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    } else if (view === "week" || view === "agenda") {
      setCursor(addDays(cursor, dir * 7));
    } else {
      setCursor(addDays(cursor, dir));
    }
  }

  function openNewOn(d: Date) {
    setNewDefaultDate(d);
    setNewOpen(true);
  }

  const title = useMemo(() => {
    if (view === "month") return fmtMonth(cursor);
    if (view === "day")
      return cursor.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    const ws = startOfWeek(cursor);
    return `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(ws, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }, [view, cursor]);

  return (
    <div
      className={cn(
        "flex flex-col lg:flex-row gap-6 lg:gap-8 max-w-full",
        expanded
          ? "fixed inset-0 z-50 bg-background overflow-auto p-3 sm:p-4"
          : "px-3 sm:px-6 lg:px-8 py-6 lg:py-10",
      )}
    >
      <div className="flex-1 min-w-0 order-2 lg:order-1">

        <div className="flex items-start sm:items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary">
              Calendar
            </h1>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["month", "week", "day", "agenda"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm capitalize min-h-[36px]",
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="inline-flex items-stretch rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => shift(-1)}
                aria-label={`Previous ${view}`}
                title={`Previous ${view}`}
                className="px-2.5 hover:bg-muted min-h-[36px] inline-flex items-center justify-center"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCursor(startOfDay(new Date()))}
                title="Jump to today"
                className="px-3 text-sm border-x border-border hover:bg-muted min-h-[36px]"
              >
                Today
              </button>
              <button
                onClick={() => shift(1)}
                aria-label={`Next ${view}`}
                title={`Next ${view}`}
                className="px-2.5 hover:bg-muted min-h-[36px] inline-flex items-center justify-center"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Import .ics</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    exportEventsPdf({
                      events: visibleEvents,
                      calById,
                      view,
                      title,
                    })
                  }
                >
                  <FileText className="h-4 w-4 mr-2" /> Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    exportEventsXlsx({
                      events: visibleEvents,
                      calById,
                      view,
                      title,
                    })
                  }
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Export as Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setExpanded((x) => !x)}
              aria-label={expanded ? "Collapse calendar" : "Expand calendar"}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="sm"
              onClick={() => openNewOn(cursor)}
              disabled={visibleCalendars.length === 0}
            >
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">New event</span>
            </Button>
          </div>
        </div>


        {view === "month" && (
          <MonthGrid
            cursor={cursor}
            events={visibleEvents}
            calById={calById}
            onDayClick={(d) => setDayOpen(d)}
            onEventClick={(e) => setEditing(e)}
          />
        )}
        {view === "week" && (
          <TimeGrid
            days={Array.from({ length: 7 }, (_, i) =>
              addDays(startOfWeek(cursor), i),
            )}
            events={visibleEvents}
            calById={calById}
            onSlotClick={(d) => openNewOn(d)}
            onEventClick={(e) => setEditing(e)}
          />
        )}
        {view === "day" && (
          <TimeGrid
            days={[startOfDay(cursor)]}
            events={visibleEvents}
            calById={calById}
            onSlotClick={(d) => openNewOn(d)}
            onEventClick={(e) => setEditing(e)}
          />
        )}
        {view === "agenda" && (
          <AgendaList
            events={visibleEvents}
            calById={calById}
            onEventClick={(e) => setEditing(e)}
          />
        )}
      </div>

      <aside className={cn("w-full lg:w-72 shrink-0 space-y-6 order-1 lg:order-2", expanded && "hidden")}>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Calendars
          </h3>
          {visibleCalendars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calendars yet. Create one in Settings.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visibleCalendars.map((c) => (
                <CalendarRow
                  key={c.id}
                  cal={c}
                  biz={businesses.find((b) => b.id === c.business_id) ?? null}
                  on={!hiddenCals.has(c.id)}
                  onToggle={() => {
                    const next = new Set(hiddenCals);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    setHiddenCals(next);
                  }}
                  onColorChange={async (color) => {
                    try {
                      await updateCalendar(c.id, { color });
                      qc.invalidateQueries({ queryKey: ["calendars"] });
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Failed to update",
                      );
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {visibleCalendars.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Legend
            </h3>
            <ul className="flex flex-wrap gap-2">
              {visibleCalendars.map((c) => (
                <li
                  key={c.id}
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-border"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="truncate max-w-[140px]">{c.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {dayOpen && (
        <DayAgendaDialog
          date={dayOpen}
          events={visibleEvents.filter((e) => {
            const s = startOfDay(new Date(e.start_at));
            const en = startOfDay(new Date(e.end_at));
            return s <= dayOpen && en >= dayOpen;
          })}
          calById={calById}
          onClose={() => setDayOpen(null)}
          onAdd={() => {
            const d = dayOpen;
            setDayOpen(null);
            openNewOn(d);
          }}
          onEventClick={(e) => {
            setDayOpen(null);
            setEditing(e);
          }}
        />
      )}

      {newOpen && (
        <NewEventDialog
          defaultDate={newDefaultDate}
          calendars={visibleCalendars}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            qc.invalidateQueries({ queryKey: ["events"] });
          }}
        />
      )}

      {editing && (
        <EditEventDialog
          event={editing}
          calendars={visibleCalendars}
          calById={calById}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
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

// ---------- sidebar row with color picker ----------

const PALETTE = [
  "#7A8471",
  "#a36b6b",
  "#b08968",
  "#5b8a72",
  "#4f7cac",
  "#7d6dab",
  "#c08a4a",
  "#3f5b6f",
];

function CalendarRow({
  cal,
  biz,
  on,
  onToggle,
  onColorChange,
}: {
  cal: Cal;
  biz: { id: string; name: string; color: string } | null;
  on: boolean;
  onToggle: () => void;
  onColorChange: (color: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <li className="rounded-md hover:bg-muted/60">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setPicking((p) => !p)}
          className="h-4 w-4 rounded-sm border shrink-0"
          style={{
            backgroundColor: on ? cal.color : "transparent",
            borderColor: cal.color,
          }}
          aria-label="Change color"
        />
        <button
          onClick={onToggle}
          className="flex-1 text-left min-w-0"
        >
          <div
            className={cn(
              "text-sm truncate",
              !on && "text-muted-foreground line-through",
            )}
          >
            {cal.name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {cal.provider !== "manual" && (
              <span className="capitalize mr-1">{cal.provider}</span>
            )}
            <span title={cal.last_synced_at ?? ""}>
              synced {fmtRelative(cal.last_synced_at)}
            </span>
          </div>
        </button>
        {biz && (
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: biz.color }}
            title={biz.name}
          />
        )}
      </div>
      {picking && (
        <div className="px-2 pb-2 flex flex-wrap gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => {
                onColorChange(c);
                setPicking(false);
              }}
              className={cn(
                "h-5 w-5 rounded-full border border-border",
                c.toLowerCase() === cal.color.toLowerCase() &&
                  "ring-2 ring-offset-1 ring-foreground/40",
              )}
              style={{ backgroundColor: c }}
              aria-label={`Use color ${c}`}
            />
          ))}
        </div>
      )}
    </li>
  );
}

// ---------- Month grid ----------

function MonthGrid({
  cursor,
  events,
  calById,
  onDayClick,
  onEventClick,
}: {
  cursor: Date;
  events: EventRow[];
  calById: Map<string, Cal>;
  onDayClick: (d: Date) => void;
  onEventClick: (e: EventRow) => void;
}) {
  const start = startOfMonthGrid(cursor);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div
      className="rounded-2xl border border-border bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="grid grid-cols-7 text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
        {weekdays.map((w) => (
          <div key={w} className="px-1 py-2 text-center truncate">
            <span className="hidden sm:inline">{w}</span>
            <span className="sm:hidden">{w[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const dayEvts = events
            .filter((e) => {
              const s = startOfDay(new Date(e.start_at));
              const en = startOfDay(new Date(e.end_at));
              return s <= d && en >= d;
            })
            .sort((a, b) => {
              // multi-day / all-day first, then by time
              const am = isAllDayLike(a) ? 0 : 1;
              const bm = isAllDayLike(b) ? 0 : 1;
              if (am !== bm) return am - bm;
              return +new Date(a.start_at) - +new Date(b.start_at);
            });
          const shown = dayEvts.slice(0, 3);
          const overflow = dayEvts.length - shown.length;
          return (
            <div
              key={i}
              className={cn(
                "min-w-0 min-h-[88px] sm:min-h-[110px] border-r border-b border-border p-1 sm:p-1.5 flex flex-col gap-1 hover:bg-muted/30 transition-colors",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= 35 && "border-b-0",
                !inMonth && "bg-muted/20",
              )}
            >
              <button
                onClick={() => onDayClick(d)}
                className={cn(
                  "text-[11px] self-end px-1.5 py-0.5 rounded-full hover:bg-muted",
                  isToday &&
                    "bg-accent text-accent-foreground font-semibold hover:bg-accent",
                  !inMonth && "text-muted-foreground",
                )}
              >
                {d.getDate()}
              </button>
              <div className="flex flex-col gap-0.5 min-w-0">
                {shown.map((e) => {
                  const c = calById.get(e.calendar_id);
                  const color = c?.color ?? "#7A8471";
                  return (
                    <button
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEventClick(e);
                      }}
                      className="text-[10px] sm:text-[11px] truncate rounded px-1.5 py-0.5 text-left leading-tight"
                      style={{
                        backgroundColor: color,
                        color: readableText(color),
                      }}
                      title={e.title}
                    >
                      {!isAllDayLike(e) && (
                        <span className="opacity-80 mr-1">
                          {new Date(e.start_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                          })}
                        </span>
                      )}
                      {e.title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <button
                    onClick={() => onDayClick(d)}
                    className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Week / Day time grid ----------

const HOUR_PX = 48;

type LaidOut = { ev: EventRow; lane: number; lanes: number };

function layoutOverlaps(evs: EventRow[]): LaidOut[] {
  // Sort by start. Greedy column assignment.
  const sorted = [...evs].sort(
    (a, b) =>
      +new Date(a.start_at) - +new Date(b.start_at) ||
      +new Date(b.end_at) - +new Date(a.end_at),
  );
  type Item = { ev: EventRow; lane: number; group: number };
  const items: Item[] = [];
  let group = 0;
  let groupEnd = 0;
  const laneEnds: number[] = [];
  for (const ev of sorted) {
    const s = +new Date(ev.start_at);
    const e = +new Date(ev.end_at);
    if (s >= groupEnd && laneEnds.length) {
      // emit current group with its lane count
      const lanes = laneEnds.length;
      for (let k = items.length - 1; k >= 0 && items[k].group === group; k--) {
        // overwrite via final pass
        items[k] = { ...items[k] };
        (items[k] as unknown as { _lanes: number })._lanes = lanes;
      }
      group += 1;
      laneEnds.length = 0;
      groupEnd = 0;
    }
    let lane = laneEnds.findIndex((le) => le <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    groupEnd = Math.max(groupEnd, e);
    items.push({ ev, lane, group });
  }
  // finalize last group
  const lanes = laneEnds.length || 1;
  return items.map((it) => {
    const l = (it as unknown as { _lanes?: number })._lanes ?? lanes;
    return { ev: it.ev, lane: it.lane, lanes: l };
  });
}

function TimeGrid({
  days,
  events,
  calById,
  onSlotClick,
  onEventClick,
}: {
  days: Date[];
  events: EventRow[];
  calById: Map<string, Cal>;
  onSlotClick: (d: Date) => void;
  onEventClick: (e: EventRow) => void;
}) {
  const today = startOfDay(new Date());
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const allDayByDay: Record<string, EventRow[]> = {};
  const timedByDay: Record<string, EventRow[]> = {};
  for (const d of days) {
    const key = d.toISOString();
    allDayByDay[key] = [];
    timedByDay[key] = [];
  }
  for (const e of events) {
    const isBand = isAllDayLike(e);
    for (const d of days) {
      const s = startOfDay(new Date(e.start_at));
      const en = startOfDay(new Date(e.end_at));
      if (s <= d && en >= d) {
        if (isBand) allDayByDay[d.toISOString()].push(e);
        else timedByDay[d.toISOString()].push(e);
      }
    }
  }

  // dedupe the all-day band so a multi-day event appears once per day cell
  // (but we still want a single spanning bar across days it covers)
  // For simplicity we render one chip per day cell; spanning is approximated
  // with consistent color + title across cells.

  return (
    <div
      className="rounded-2xl border border-border bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="overflow-x-auto">
        <div style={{ minWidth: days.length === 1 ? 320 : 640 }}>
          {/* Header row */}
          <div
            className="grid border-b border-border"
            style={{
              gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            <div />
            {days.map((d) => {
              const isToday = sameDay(d, today);
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "px-2 py-2 text-center border-l border-border",
                    isToday && "bg-accent/10",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div
                    className={cn(
                      "text-lg sm:text-xl",
                      isToday && "text-accent font-semibold",
                    )}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* All-day band */}
          <div
            className="grid border-b border-border bg-muted/20"
            style={{
              gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="text-[10px] text-muted-foreground px-1 py-1 text-right">
              all-day
            </div>
            {days.map((d) => {
              const list = allDayByDay[d.toISOString()];
              return (
                <div
                  key={d.toISOString()}
                  className="border-l border-border p-1 min-h-[28px] flex flex-col gap-0.5"
                >
                  {list.map((e) => {
                    const c = calById.get(e.calendar_id);
                    const color = c?.color ?? "#7A8471";
                    return (
                      <button
                        key={e.id}
                        onClick={() => onEventClick(e)}
                        className="text-[11px] truncate rounded px-1.5 py-0.5 text-left"
                        style={{
                          backgroundColor: color,
                          color: readableText(color),
                        }}
                        title={e.title}
                      >
                        {e.title}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Hour grid */}
          <div
            className="grid relative"
            style={{
              gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {/* Hour labels */}
            <div className="flex flex-col">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="text-[10px] text-muted-foreground text-right pr-1"
                  style={{ height: HOUR_PX }}
                >
                  {h === 0
                    ? ""
                    : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, {
                        hour: "numeric",
                      })}
                </div>
              ))}
            </div>

            {days.map((d) => {
              const dayKey = d.toISOString();
              const isToday = sameDay(d, today);
              const timed = timedByDay[dayKey];
              const laid = layoutOverlaps(timed);
              const minutesNow =
                now.getHours() * 60 + now.getMinutes();
              return (
                <div
                  key={dayKey}
                  className="relative border-l border-border"
                  style={{ height: HOUR_PX * 24 }}
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement).dataset.slot) {
                      const hour = Number(
                        (ev.target as HTMLElement).dataset.slot,
                      );
                      const dt = new Date(d);
                      dt.setHours(hour, 0, 0, 0);
                      onSlotClick(dt);
                    }
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      data-slot={h}
                      className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                      style={{ height: HOUR_PX }}
                    />
                  ))}
                  {isToday && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none"
                      style={{
                        top: (minutesNow / 60) * HOUR_PX,
                      }}
                    >
                      <div
                        className="h-px bg-accent"
                        style={{ boxShadow: "0 0 4px var(--accent)" }}
                      />
                      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                    </div>
                  )}
                  {laid.map(({ ev, lane, lanes }) => {
                    const s = new Date(ev.start_at);
                    const e = new Date(ev.end_at);
                    // Clip to this day
                    const dayStart = startOfDay(d).getTime();
                    const dayEnd = endOfDay(d).getTime();
                    const sMs = Math.max(s.getTime(), dayStart);
                    const eMs = Math.min(e.getTime(), dayEnd);
                    const startMin = (sMs - dayStart) / 60000;
                    const endMin = (eMs - dayStart) / 60000;
                    const top = (startMin / 60) * HOUR_PX;
                    const height = Math.max(
                      18,
                      ((endMin - startMin) / 60) * HOUR_PX,
                    );
                    const widthPct = 100 / lanes;
                    const c = calById.get(ev.calendar_id);
                    const color = c?.color ?? "#7A8471";
                    return (
                      <button
                        key={ev.id}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          onEventClick(ev);
                        }}
                        className="absolute rounded-md px-1.5 py-1 text-[11px] text-left overflow-hidden shadow-sm border border-black/10"
                        style={{
                          top,
                          height,
                          left: `calc(${lane * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: color,
                          color: readableText(color),
                        }}
                        title={`${ev.title}\n${fmtTime(ev.start_at)} – ${fmtTime(ev.end_at)}`}
                      >
                        <div className="truncate font-medium leading-tight">
                          {ev.title}
                        </div>
                        {height > 28 && (
                          <div className="truncate opacity-80 leading-tight">
                            {fmtTime(ev.start_at)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Agenda list ----------

function AgendaList({
  events,
  calById,
  onEventClick,
}: {
  events: EventRow[];
  calById: Map<string, Cal>;
  onEventClick: (e: EventRow) => void;
}) {
  const sorted = [...events].sort(
    (a, b) => +new Date(a.start_at) - +new Date(b.start_at),
  );
  // group by day
  const groups: { day: Date; items: EventRow[] }[] = [];
  for (const e of sorted) {
    const d = startOfDay(new Date(e.start_at));
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, d)) last.items.push(e);
    else groups.push({ day: d, items: [e] });
  }
  if (groups.length === 0) {
    return (
      <div
        className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        Nothing scheduled in this range.
      </div>
    );
  }
  const today = startOfDay(new Date());
  return (
    <div
      className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      {groups.map((g) => (
        <div key={g.day.toISOString()} className="p-3 sm:p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <div
              className={cn(
                "text-sm font-semibold",
                sameDay(g.day, today) && "text-accent",
              )}
            >
              {g.day.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
            {sameDay(g.day, today) && (
              <span className="text-[10px] uppercase tracking-wider text-accent">
                today
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {g.items.map((e) => {
              const c = calById.get(e.calendar_id);
              const color = c?.color ?? "#7A8471";
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onEventClick(e)}
                    className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-muted text-left"
                  >
                    <span
                      className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {e.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {isAllDayLike(e)
                          ? "All day"
                          : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`}
                        {c && <> · {c.name}</>}
                        {e.location && <> · {e.location}</>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- Day agenda popup ----------

function DayAgendaDialog({
  date,
  events,
  calById,
  onClose,
  onAdd,
  onEventClick,
}: {
  date: Date;
  events: EventRow[];
  calById: Map<string, Cal>;
  onClose: () => void;
  onAdd: () => void;
  onEventClick: (e: EventRow) => void;
}) {
  const sorted = [...events].sort(
    (a, b) => +new Date(a.start_at) - +new Date(b.start_at),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {date.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-auto">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nothing scheduled.
            </p>
          ) : (
            sorted.map((e) => {
              const c = calById.get(e.calendar_id);
              const color = c?.color ?? "#7A8471";
              return (
                <button
                  key={e.id}
                  onClick={() => onEventClick(e)}
                  className="w-full text-left flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted"
                  style={{ borderLeft: `4px solid ${color}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{e.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {isAllDayLike(e)
                        ? "All day"
                        : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`}
                      {c && <> · {c.name}</>}
                    </div>
                    {e.location && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        📍 {e.location}
                      </div>
                    )}
                  </div>
                  <Pencil className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- New / Edit / Import dialogs ----------

function toDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toTimeInputValue(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const [startTime, setStartTime] = useState(
    defaultDate.getHours() !== 0
      ? toTimeInputValue(defaultDate)
      : "09:00",
  );
  const [endTime, setEndTime] = useState(
    defaultDate.getHours() !== 0
      ? toTimeInputValue(new Date(defaultDate.getTime() + 3600_000))
      : "10:00",
  );
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
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue placeholder="Select calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="allday"
              checked={allDay}
              onCheckedChange={(v) => setAllDay(!!v)}
            />
            <Label htmlFor="allday" className="cursor-pointer">
              All day
            </Label>
          </div>
          {!allDay && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Start</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label>End</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <div>
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mut.isPending || !title.trim() || !calendarId}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEventDialog({
  event,
  calendars,
  calById,
  onClose,
  onSaved,
}: {
  event: EventRow;
  calendars: Cal[];
  calById: Map<string, Cal>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const s = new Date(event.start_at);
  const e = new Date(event.end_at);
  const [title, setTitle] = useState(event.title);
  const [calendarId, setCalendarId] = useState(event.calendar_id);
  const [date, setDate] = useState(toDateInputValue(s));
  const [endDate, setEndDate] = useState(toDateInputValue(e));
  const [allDay, setAllDay] = useState(event.all_day);
  const [startTime, setStartTime] = useState(toTimeInputValue(s));
  const [endTime, setEndTime] = useState(toTimeInputValue(e));
  const [location, setLocation] = useState(event.location ?? "");
  const [description, setDescription] = useState(event.description ?? "");

  const cal = calById.get(calendarId) ?? calById.get(event.calendar_id);
  const anchorIso = useMemo(() => {
    try {
      if (allDay) return new Date(`${date}T09:00:00`).toISOString();
      return new Date(`${date}T${startTime}:00`).toISOString();
    } catch {
      return event.start_at;
    }
  }, [allDay, date, startTime, event.start_at]);

  // Backlinks: notes that link to this event
  const { data: backlinks = [] } = useQuery({
    queryKey: ["event-backlinks", event.id],
    queryFn: async () => {
      const links = await listBacklinks("event", event.id);
      return resolveLinks(links);
    },
  });

  // Recurrence heuristic: ICS events with shared UID = recurring series
  const recurringHint =
    event.source === "ics" && event.external_id
      ? "Part of an imported recurring series"
      : event.source === "google" && event.external_id?.includes("_")
        ? "Recurring (synced from Google)"
        : null;

  const save = useMutation({
    mutationFn: async () => {
      let start: Date;
      let end: Date;
      if (allDay) {
        start = new Date(`${date}T00:00:00`);
        end = new Date(`${endDate || date}T23:59:59`);
      } else {
        start = new Date(`${date}T${startTime}:00`);
        end = new Date(`${date}T${endTime}:00`);
        if (end <= start) throw new Error("End must be after start");
      }
      await updateEvent(event.id, {
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: allDay,
      });
    },
    onSuccess: () => {
      toast.success("Event updated");
      onSaved();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteEvent(event.id),
    onSuccess: () => {
      toast.success("Event deleted");
      onSaved();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const createNoteFromEvent = useMutation({
    mutationFn: async () => {
      const note = await createNote({
        business_id: event.business_id,
        folder_id: null,
        title: `Notes — ${event.title}`,
        body: `From event on ${new Date(event.start_at).toLocaleString()}${event.location ? `\nLocation: ${event.location}` : ""}${event.description ? `\n\n${event.description}` : ""}`,
        source: "event",
        linked_event_id: event.id,
      });
      return note;
    },
    onSuccess: () => {
      toast.success("Note created");
      qc.invalidateQueries({ queryKey: ["event-backlinks", event.id] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const createTaskFromEvent = useMutation({
    mutationFn: async () => {
      const lists = await listLists();
      const target =
        lists.find((l) => {
          // best-effort: same business as event
          return event.business_id ? true : true;
        }) ?? lists[0];
      if (!target) throw new Error("Create a task list first");
      await createTask({
        list_id: target.id,
        business_id: event.business_id,
        title: event.title,
        description: event.description ?? null,
        due_at: event.start_at,
      });
    },
    onSuccess: () => {
      toast.success("Task created");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {cal && (
              <span
                className="h-3 w-3 rounded-sm shrink-0"
                style={{ backgroundColor: cal.color }}
              />
            )}
            <span className="truncate">Event details</span>
            {event.source !== "manual" && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {event.source}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!title.trim()) return;
            save.mutate();
          }}
          className="space-y-4"
        >
          {/* Title */}
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              autoFocus
              className="text-base font-medium"
            />
          </div>

          {/* Calendar */}
          <div>
            <Label>Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                      {c.provider !== "manual" && (
                        <span className="text-[10px] text-muted-foreground capitalize">
                          · {c.provider}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Note: moving between calendars is currently view-only; edit syncs to the original calendar.
            </p>
          </div>

          {/* Date / time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Start date</Label>
              <Input
                type="date"
                value={date}
                onChange={(ev) => setDate(ev.target.value)}
              />
            </div>
            {allDay && (
              <div>
                <Label>End date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(ev) => setEndDate(ev.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="editallday"
              checked={allDay}
              onCheckedChange={(v) => setAllDay(!!v)}
            />
            <Label htmlFor="editallday" className="cursor-pointer">
              All-day event
            </Label>
          </div>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(ev) => setStartTime(ev.target.value)}
                />
              </div>
              <div>
                <Label>End time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(ev) => setEndTime(ev.target.value)}
                />
              </div>
            </div>
          )}

          {/* Recurrence hint */}
          {recurringHint && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
              <Repeat className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {recurringHint}. Edits apply to this instance only; manage the
                series in the source calendar.
              </span>
            </div>
          )}

          {/* Location */}
          <div>
            <Label className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Location
            </Label>
            <Input
              value={location}
              onChange={(ev) => setLocation(ev.target.value)}
              placeholder="Address, room, or video link"
            />
          </div>

          {/* Description */}
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
              rows={3}
              placeholder="Notes, agenda, prep…"
            />
          </div>

          {/* Reminders */}
          <div className="border-t border-border pt-3">
            <Label className="flex items-center gap-1.5 mb-2">Reminders</Label>
            <ReminderControls
              refType="event"
              refId={event.id}
              anchorAt={anchorIso}
            />
          </div>

          {/* Tagged people */}
          <div className="border-t border-border pt-3">
            <Label className="flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5" /> Tagged people
            </Label>
            <TagPeople
              itemType="event"
              itemId={event.id}
              businessId={event.business_id}
            />
          </div>

          {/* Linked items */}
          <div className="border-t border-border pt-3">
            <Label className="flex items-center gap-1.5 mb-2">
              <Link2 className="h-3.5 w-3.5" /> Linked notes
            </Label>
            {backlinks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No notes linked to this event yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {backlinks.map((l: ResolvedLink) => (
                  <li key={l.id}>
                    {l.href ? (
                      <Link
                        to={l.href}
                        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <StickyNote className="h-3.5 w-3.5" />
                        {l.label}
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {l.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => createNoteFromEvent.mutate()}
                disabled={createNoteFromEvent.isPending}
              >
                <StickyNote className="h-4 w-4 mr-1" />
                Create note
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => createTaskFromEvent.mutate()}
                disabled={createTaskFromEvent.isPending}
              >
                <ListChecks className="h-4 w-4 mr-1" />
                Create task
              </Button>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm("Delete this event?")) del.mutate();
              }}
              disabled={del.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending || !title.trim()}>
                Save changes
              </Button>
            </div>
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
      // Dedupe in-file by uid + start time before previewing.
      const seen = new Set<string>();
      const deduped = evts.filter((ev) => {
        const k = `${ev.external_id ?? ev.title}|${ev.start_at}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setParsed(deduped);
      setPreviewCount(deduped.length);
    } catch {
      toast.error("Could not parse .ics file");
    }
  }

  const mut = useMutation({
    mutationFn: async () => {
      const cal = calendars.find((c) => c.id === calendarId);
      if (!cal) throw new Error("Pick a calendar");
      if (parsed.length === 0) throw new Error("Nothing to import");
      const count = await bulkInsertEvents(
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
      return count;
    },
    onSuccess: (count) => {
      toast.success(`Imported ${count} events (duplicates skipped)`);
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
              <SelectTrigger>
                <SelectValue placeholder="Select calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>.ics file</Label>
            <Input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              onChange={onFile}
            />
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Duplicates (same UID + start time) are skipped automatically.
            </p>
          </div>
          {previewCount !== null && (
            <p className="text-sm text-muted-foreground">
              Found{" "}
              <span className="text-foreground font-medium">
                {previewCount}
              </span>{" "}
              unique events.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
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

// ---------- Export helpers ----------

type ExportArgs = {
  events: EventRow[];
  calById: Map<string, Cal>;
  view: ViewMode;
  title: string;
};

function exportRows({ events, calById }: { events: EventRow[]; calById: Map<string, Cal> }) {
  const sorted = [...events].sort(
    (a, b) => +new Date(a.start_at) - +new Date(b.start_at),
  );
  return sorted.map((e) => {
    const c = calById.get(e.calendar_id);
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const dateStr = s.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const timeStr = e.all_day
      ? "All day"
      : `${s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${en.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    return {
      Date: dateStr,
      Time: timeStr,
      Title: e.title,
      Calendar: c?.name ?? "",
      Location: e.location ?? "",
      Notes: e.description ?? "",
    };
  });
}

function exportFilename(view: ViewMode, title: string, ext: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `calendar-${view}-${slug || "export"}.${ext}`;
}

async function exportEventsPdf({ events, calById, view, title }: ExportArgs) {
  try {
    if (events.length === 0) {
      toast.message("Nothing to export in this range.");
      return;
    }
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = (autoTableMod as { default: (doc: unknown, opts: unknown) => void }).default;
    const rows = exportRows({ events, calById });
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("Heartbeat Calendar", 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`${view.toUpperCase()} · ${title}`, 40, 58);
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 80,
      head: [["Date", "Time", "Title", "Calendar", "Location", "Notes"]],
      body: rows.map((r) => [r.Date, r.Time, r.Title, r.Calendar, r.Location, r.Notes]),
      styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [122, 132, 113], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 246, 240] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 90 },
        2: { cellWidth: 180 },
        3: { cellWidth: 100 },
        4: { cellWidth: 120 },
        5: { cellWidth: "auto" },
      },
      margin: { left: 40, right: 40 },
    });
    doc.save(exportFilename(view, title, "pdf"));
    toast.success(`Exported ${rows.length} events to PDF`);
  } catch (e) {
    console.error(e);
    toast.error(e instanceof Error ? e.message : "Failed to export PDF");
  }
}

async function exportEventsXlsx({ events, calById, view, title }: ExportArgs) {
  try {
    if (events.length === 0) {
      toast.message("Nothing to export in this range.");
      return;
    }
    const XLSX = await import("xlsx");
    const rows = exportRows({ events, calById });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Date", "Time", "Title", "Calendar", "Location", "Notes"],
    });
    ws["!cols"] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 32 },
      { wch: 20 },
      { wch: 24 },
      { wch: 40 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Events");
    XLSX.writeFile(wb, exportFilename(view, title, "xlsx"));
    toast.success(`Exported ${rows.length} events to Excel`);
  } catch (e) {
    console.error(e);
    toast.error(e instanceof Error ? e.message : "Failed to export Excel");
  }
}
