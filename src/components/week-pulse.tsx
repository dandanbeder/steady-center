import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { listEvents, type EventRow } from "@/lib/calendars";
import { listMeetings, type Meeting } from "@/lib/meetings";
import { getWorkingHours } from "@/lib/user-prefs";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { cn } from "@/lib/utils";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_MEETING_HOURS = 1;

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

type Status = "sage" | "gold" | "clay";

function statusFor(loadH: number, capacity: number): Status {
  if (capacity <= 0) return loadH > 0 ? "clay" : "sage";
  const r = loadH / capacity;
  if (r < 0.75) return "sage";
  if (r <= 1.05) return "gold";
  return "clay";
}

const COLOR_VAR: Record<Status, string> = {
  sage: "var(--pulse-sage)",
  gold: "var(--pulse-gold)",
  clay: "var(--pulse-clay)",
};

type StandaloneMeeting = { id: string; title: string; scheduled_at: string };

type DayPulse = {
  date: Date;
  loadH: number;
  capacity: number;
  status: Status;
  events: EventRow[];
  meetings: StandaloneMeeting[];
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
  const { data: hours } = useQuery({
    queryKey: ["working-hours"],
    queryFn: getWorkingHours,
  });

  const dailyCap = hours?.daily_capacity_hours ?? 6;
  const workDays = hours?.work_days ?? [1, 2, 3, 4, 5];

  const visibleEvents = activeId === ALL ? events : events.filter((e) => e.business_id === activeId);
  // Use meetings as a signal only when they aren't already represented by a calendar event
  // (avoids double-counting). Account filter respected the same way.
  const standaloneMeetings: StandaloneMeeting[] = (allMeetings as Meeting[])
    .filter((m) => !m.event_id && m.scheduled_at)
    .filter((m) => activeId === ALL || m.business_id === activeId)
    .map((m) => ({ id: m.id, title: m.title, scheduled_at: m.scheduled_at as string }));

  const today = new Date();

  const days: DayPulse[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dayEvents = visibleEvents.filter((e) => sameDay(new Date(e.start_at), d));
      const dayMeetings = standaloneMeetings.filter((m) => sameDay(new Date(m.scheduled_at), d));
      const loadH =
        dayEvents.reduce((s, e) => s + eventHours(e), 0) +
        dayMeetings.length * DEFAULT_MEETING_HOURS;
      const isWorkDay = workDays.includes(d.getDay());
      const capacity = isWorkDay ? dailyCap : Math.max(dailyCap * 0.25, 1);
      return {
        date: d,
        loadH,
        capacity,
        status: statusFor(loadH, capacity),
        events: dayEvents,
        meetings: dayMeetings,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, visibleEvents, JSON.stringify(standaloneMeetings.map((m) => m.id)), dailyCap, workDays]);

  return (
    <PulseStrip
      days={days}
      today={today}
      className={className}
      onDayClick={(d) => {
        if (onDayClick) onDayClick(d);
        else navigate({ to: "/my-week" });
      }}
    />
  );
}

// ---------- Pure visual ----------

const VIEW_W = 700;
const VIEW_H = 80;
const PAD_X = 28;
const BASE_Y = 56;
const MAX_AMP = 38;

function PulseStrip({
  days,
  today,
  className,
  onDayClick,
}: {
  days: DayPulse[];
  today: Date;
  className?: string;
  onDayClick: (d: Date) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const usableW = VIEW_W - PAD_X * 2;

  // Day x positions
  const pts = days.map((d, i) => {
    const x = PAD_X + (usableW * (i + 0.5)) / 7;
    const ratio = d.capacity > 0 ? d.loadH / d.capacity : 0;
    const amp = Math.min(1.3, ratio) * MAX_AMP;
    const y = BASE_Y - amp;
    return { x, y, amp, ...d, idx: i };
  });

  // Build an ECG-like polyline: baseline between days, sharp spike at each day.
  const path = useMemo(() => {
    const parts: string[] = [];
    parts.push(`M 0 ${BASE_Y}`);
    pts.forEach((p, i) => {
      const prevX = i === 0 ? PAD_X / 2 : (pts[i - 1].x + p.x) / 2;
      const nextX = i === pts.length - 1 ? VIEW_W - PAD_X / 2 : (pts[i + 1].x + p.x) / 2;
      // approach baseline
      parts.push(`L ${prevX.toFixed(1)} ${BASE_Y}`);
      // tiny dip
      parts.push(`L ${(p.x - 10).toFixed(1)} ${(BASE_Y + Math.min(6, p.amp * 0.2)).toFixed(1)}`);
      // peak up
      parts.push(`L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
      // sharp down past baseline
      parts.push(`L ${(p.x + 6).toFixed(1)} ${(BASE_Y + Math.min(8, p.amp * 0.25)).toFixed(1)}`);
      // return baseline
      parts.push(`L ${nextX.toFixed(1)} ${BASE_Y}`);
    });
    parts.push(`L ${VIEW_W} ${BASE_Y}`);
    return parts.join(" ");
  }, [pts]);

  const hovered = hoverIdx != null ? pts[hoverIdx] : null;

  return (
    <div
      className={cn(
        "relative w-full select-none",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full h-16 sm:h-20 overflow-visible"
        role="img"
        aria-label="Week pulse, load per day"
      >
        {/* baseline */}
        <line
          x1={0}
          x2={VIEW_W}
          y1={BASE_Y}
          y2={BASE_Y}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        {/* trace */}
        <path
          d={path}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* per-day dots & hit targets */}
        {pts.map((p) => {
          const isToday = sameDay(p.date, today);
          const color = COLOR_VAR[p.status];
          return (
            <g key={p.idx}>
              {isToday && (
                <circle cx={p.x} cy={p.y} r={8} fill={color} opacity={0.18} />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={hoverIdx === p.idx ? 4.5 : 3.2}
                fill={color}
                stroke="var(--background)"
                strokeWidth={1.5}
                style={{ transition: "r 120ms ease" }}
              />
              {/* invisible hit area covering the day's column */}
              <rect
                x={PAD_X + (usableW * p.idx) / 7}
                y={0}
                width={usableW / 7}
                height={VIEW_H}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverIdx(p.idx)}
                onMouseLeave={() =>
                  setHoverIdx((cur) => (cur === p.idx ? null : cur))
                }
                onClick={() => onDayClick(p.date)}
                onTouchStart={() => setHoverIdx(p.idx)}
              >
                <title>
                  {DAY_NAMES[p.idx]} {p.date.getDate()} · {p.loadH.toFixed(1)}h
                  /{p.capacity.toFixed(0)}h
                </title>
              </rect>
            </g>
          );
        })}
      </svg>

      {/* Day labels */}
      <div className="mt-1 grid grid-cols-7 gap-0 px-[4%] text-[10px] uppercase tracking-wider text-muted-foreground">
        {pts.map((p) => {
          const isToday = sameDay(p.date, today);
          return (
            <button
              key={p.idx}
              type="button"
              onClick={() => onDayClick(p.date)}
              onMouseEnter={() => setHoverIdx(p.idx)}
              onMouseLeave={() =>
                setHoverIdx((cur) => (cur === p.idx ? null : cur))
              }
              className={cn(
                "text-center py-0.5 rounded transition-colors hover:text-foreground",
                isToday && "text-foreground font-medium",
              )}
            >
              {DAY_NAMES[p.idx]}
            </button>
          );
        })}
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 mt-1 w-56 rounded-md border border-border bg-popover text-popover-foreground p-3 shadow-md text-xs"
          style={{
            left: `${(hovered.x / VIEW_W) * 100}%`,
            top: 0,
          }}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {hovered.date.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: COLOR_VAR[hovered.status] }}
            >
              {hovered.status === "sage"
                ? "Light"
                : hovered.status === "gold"
                  ? "Full"
                  : "Very full"}
            </span>
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {hovered.loadH.toFixed(1)}h scheduled
          </div>
          {(hovered.events.length > 0 || hovered.meetings.length > 0) && (
            <ul className="mt-2 space-y-0.5">
              {hovered.events.slice(0, 3).map((e) => (
                <li key={`e-${e.id}`} className="truncate">
                  · {e.title}
                </li>
              ))}
              {hovered.meetings.slice(0, 3).map((m) => (
                <li key={`m-${m.id}`} className="truncate text-muted-foreground">
                  · {m.title}
                </li>
              ))}
              {hovered.events.length + hovered.meetings.length > 6 && (
                <li className="text-muted-foreground/70">
                  +{hovered.events.length + hovered.meetings.length - 6} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
