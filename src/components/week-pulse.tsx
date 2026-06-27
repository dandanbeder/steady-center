import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { listEvents, type EventRow } from "@/lib/calendars";
import { listMeetings, type Meeting } from "@/lib/meetings";
import { listTasksInRange, type Task } from "@/lib/tasks";
import { listSharedWithMeResources, type SharedItemRow } from "@/lib/shares.functions";
import { getWorkingHours } from "@/lib/user-prefs";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { cn } from "@/lib/utils";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_MEETING_HOURS = 1;
const TASK_HOURS = 1;
const SHARED_ITEM_WEIGHT = 0.25;

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventHours(e: EventRow): number {
  if (e.all_day) return 0;
  const ms = +new Date(e.end_at) - +new Date(e.start_at);
  return Math.max(0, ms / 3_600_000);
}

type Fullness = "light" | "moderate" | "full" | "veryFull";

function fullnessFor(loadH: number, capacity: number): Fullness {
  if (loadH <= 0) return "light";
  if (capacity <= 0) return loadH > 0 ? "veryFull" : "light";
  const r = loadH / capacity;
  if (r < 0.4) return "light";
  if (r < 0.8) return "moderate";
  if (r <= 1.05) return "full";
  return "veryFull";
}

const FULLNESS_LABEL: Record<Fullness, string> = {
  light: "Light",
  moderate: "Filling up",
  full: "Full",
  veryFull: "Very full",
};

const FULLNESS_COLOR: Record<Fullness, string> = {
  light: "var(--pulse-sage)",
  moderate: "var(--pulse-sage)",
  full: "var(--pulse-gold)",
  veryFull: "var(--pulse-clay)",
};

const FULLNESS_OPACITY: Record<Fullness, number> = {
  light: 0.4,
  moderate: 0.7,
  full: 0.9,
  veryFull: 1,
};

type StandaloneMeeting = { id: string; title: string; scheduled_at: string };

type DayPulse = {
  date: Date;
  loadH: number;
  capacity: number;
  fullness: Fullness;
  events: EventRow[];
  meetings: StandaloneMeeting[];
  tasks: Task[];
  shared: SharedItemRow[];
};

export function WeekPulse({
  className,
  anchor,
  onDayClick,
}: {
  className?: string;
  anchor?: Date;
  /** When set, called on day click. Otherwise navigates to /my-week. */
  onDayClick?: (date: Date) => void;
}) {
  const { activeId } = useActiveBusiness();
  const navigate = useNavigate();

  const weekStart = useMemo(() => mondayOf(anchor ?? new Date()), [anchor]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  const weekKey = weekStart.toISOString();

  const { data: events = [] } = useQuery({
    queryKey: ["week-pulse-events", weekKey],
    queryFn: () => listEvents(weekStart, weekEnd),
  });
  const { data: allMeetings = [] } = useQuery({
    queryKey: ["week-pulse-meetings"],
    queryFn: () => listMeetings(),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["week-pulse-tasks", weekKey],
    queryFn: () => listTasksInRange(weekStart, weekEnd),
  });
  const { data: shared = [] } = useQuery<SharedItemRow[]>({
    queryKey: ["week-pulse-shared", weekKey],
    queryFn: () => listSharedWithMeResources(),
    retry: false,
  });
  const { data: hours } = useQuery({
    queryKey: ["working-hours"],
    queryFn: getWorkingHours,
  });

  const dailyCap = hours?.daily_capacity_hours ?? 6;
  const workDays = hours?.work_days ?? [1, 2, 3, 4, 5];

  // RLS: events/meetings/tasks come from user-scoped Supabase client (owner or
  // membership/share). Shared list returns only shares granted to this user.
  // No other user's items appear. Journal is never queried here.
  const scopedEvents = activeId === ALL ? events : events.filter((e) => e.business_id === activeId);
  const scopedTasks = activeId === ALL ? tasks : tasks.filter((t) => t.business_id === activeId);
  const standaloneMeetings: StandaloneMeeting[] = (allMeetings as Meeting[])
    .filter((m) => !m.event_id && m.scheduled_at)
    .filter((m) => activeId === ALL || m.business_id === activeId)
    .map((m) => ({ id: m.id, title: m.title, scheduled_at: m.scheduled_at as string }));
  // Shared items: only contribute when viewing All Accounts. When the user is
  // filtered to one account, shared items (which aren't owned by them) are
  // out of scope for that account's week.
  const scopedShared: SharedItemRow[] =
    activeId === ALL
      ? (shared ?? []).filter((s) => {
          const t = +new Date(s.created_at);
          return t >= +weekStart && t < +weekEnd;
        })
      : [];

  const today = new Date();

  const days: DayPulse[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dayEvents = scopedEvents.filter((e) => sameDay(new Date(e.start_at), d));
      const dayMeetings = standaloneMeetings.filter((m) => sameDay(new Date(m.scheduled_at), d));
      const dayTasks = scopedTasks.filter((t) => t.due_at && sameDay(new Date(t.due_at), d));
      const dayShared = scopedShared.filter((s) => sameDay(new Date(s.created_at), d));
      const loadH =
        dayEvents.reduce((s, e) => s + eventHours(e), 0) +
        dayMeetings.length * DEFAULT_MEETING_HOURS +
        dayTasks.length * TASK_HOURS +
        dayShared.length * SHARED_ITEM_WEIGHT;
      const isWorkDay = workDays.includes(d.getDay());
      const capacity = isWorkDay ? dailyCap : Math.max(dailyCap * 0.25, 1);
      return {
        date: d,
        loadH,
        capacity,
        fullness: fullnessFor(loadH, capacity),
        events: dayEvents,
        meetings: dayMeetings,
        tasks: dayTasks,
        shared: dayShared,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    weekStart,
    scopedEvents,
    scopedTasks,
    JSON.stringify(standaloneMeetings.map((m) => m.id)),
    JSON.stringify(scopedShared.map((s) => s.share_id)),
    dailyCap,
    workDays,
  ]);

  // Calm summary: name the fullest day, neutrally, load only, no judgement.
  const totalLoad = days.reduce((s, d) => s + d.loadH, 0);
  let summary: string | null = null;
  if (totalLoad >= 1) {
    const fullest = days.reduce((a, b) => (b.loadH > a.loadH ? b : a));
    if (fullest.loadH > 0) {
      const idx = (fullest.date.getDay() + 6) % 7;
      summary = `${FULL_DAY_NAMES[idx]} looks like your fullest day.`;
    }
  }

  return (
    <div className={className}>
      <PulseBars
        days={days}
        today={today}
        onDayClick={(d) => {
          if (onDayClick) onDayClick(d);
          else navigate({ to: "/my-week" });
        }}
      />
      {summary && (
        <p className="mt-2 text-xs text-muted-foreground text-center">{summary}</p>
      )}
    </div>
  );
}

// ---------- Pure visual ----------

function PulseBars({
  days,
  today,
  onDayClick,
}: {
  days: DayPulse[];
  today: Date;
  onDayClick: (d: Date) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxLoad = Math.max(
    1,
    ...days.map((d) => d.loadH),
    ...days.map((d) => d.capacity),
  );

  return (
    <div className="relative w-full select-none" role="img" aria-label="Week fullness, load per day">
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 items-end h-20 sm:h-24 px-1">
        {days.map((d, i) => {
          const isToday = sameDay(d.date, today);
          const ratio = Math.min(1, d.loadH / maxLoad);
          // Minimum visible nub so an empty day still reads as "light".
          const heightPct = Math.max(8, Math.round(ratio * 100));
          const color = FULLNESS_COLOR[d.fullness];
          const opacity = FULLNESS_OPACITY[d.fullness];
          const isHover = hoverIdx === i;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              onClick={() => onDayClick(d.date)}
              className={cn(
                "group relative h-full flex items-end justify-center rounded-md transition-colors",
                "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                isToday && "bg-accent/5 ring-1 ring-accent/40",
              )}
              aria-label={`${FULL_DAY_NAMES[i]}, ${FULLNESS_LABEL[d.fullness].toLowerCase()}, ${d.loadH.toFixed(1)} hours`}
            >
              <span
                className="block w-full max-w-[28px] rounded-t-md transition-all"
                style={{
                  height: `${heightPct}%`,
                  background: color,
                  opacity: isHover ? Math.min(1, opacity + 0.1) : opacity,
                }}
              />
              <title>
                {DAY_NAMES[i]} {d.date.getDate()} · {FULLNESS_LABEL[d.fullness]} · {d.loadH.toFixed(1)}h
              </title>
            </button>
          );
        })}
      </div>

      {/* Day labels */}
      <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {days.map((d, i) => {
          const isToday = sameDay(d.date, today);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDayClick(d.date)}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              className={cn(
                "text-center py-0.5 rounded transition-colors hover:text-foreground",
                isToday && "text-foreground font-medium",
              )}
            >
              {DAY_NAMES[i]}
              <span className="ml-1 opacity-60 tabular-nums">{d.date.getDate()}</span>
            </button>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoverIdx != null && (() => {
        const d = days[hoverIdx];
        const leftPct = ((hoverIdx + 0.5) / 7) * 100;
        const itemCount = d.events.length + d.meetings.length + d.tasks.length + d.shared.length;
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 mt-1 w-60 rounded-md border border-border bg-popover text-popover-foreground p-3 shadow-md text-xs"
            style={{ left: `${leftPct}%`, top: 0 }}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {d.date.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: FULLNESS_COLOR[d.fullness] }}
              >
                {FULLNESS_LABEL[d.fullness]}
              </span>
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {d.loadH.toFixed(1)}h scheduled · {itemCount} item{itemCount === 1 ? "" : "s"}
            </div>
            {itemCount > 0 && (
              <ul className="mt-2 space-y-0.5">
                {d.events.slice(0, 2).map((e) => (
                  <li key={`e-${e.id}`} className="truncate">· {e.title}</li>
                ))}
                {d.meetings.slice(0, 2).map((m) => (
                  <li key={`m-${m.id}`} className="truncate text-muted-foreground">· {m.title}</li>
                ))}
                {d.tasks.slice(0, 2).map((t) => (
                  <li key={`t-${t.id}`} className="truncate text-muted-foreground">· {t.title}</li>
                ))}
                {d.shared.slice(0, 1).map((s) => (
                  <li key={`s-${s.share_id}`} className="truncate text-muted-foreground/80">
                    · Shared: {s.title}
                  </li>
                ))}
                {itemCount > 7 && (
                  <li className="text-muted-foreground/70">+{itemCount - 7} more</li>
                )}
              </ul>
            )}
          </div>
        );
      })()}
    </div>
  );
}
