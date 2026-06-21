import { useMemo } from "react";
import type { EventRow } from "@/lib/calendars";
import type { Business } from "@/lib/businesses";
import type { Calendar as Cal } from "@/lib/calendars";

/**
 * Time-split summary: hours/% per account from events in the visible range.
 * Calm pastel meter — no alarms, just a sense of where the week is going.
 */
export function TimeSplitSummary({
  events,
  calendars,
  businesses,
  rangeStart,
  rangeEnd,
}: {
  events: EventRow[];
  calendars: Cal[];
  businesses: Business[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const calById = useMemo(
    () => new Map(calendars.map((c) => [c.id, c])),
    [calendars],
  );
  const bizById = useMemo(
    () => new Map(businesses.map((b) => [b.id, b])),
    [businesses],
  );

  const segments = useMemo(() => {
    const totals = new Map<string, number>(); // bizId | "__personal" → minutes
    const rs = rangeStart.getTime();
    const re = rangeEnd.getTime();
    for (const e of events) {
      const s = Math.max(new Date(e.start_at).getTime(), rs);
      const en = Math.min(new Date(e.end_at).getTime(), re);
      if (en <= s) continue;
      // All-day events: count as 1 hour symbolic so they show up
      const mins = e.all_day ? 60 : (en - s) / 60_000;
      const cal = calById.get(e.calendar_id);
      const key = cal?.business_id ?? "__personal";
      totals.set(key, (totals.get(key) ?? 0) + mins);
    }
    const total = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    return Array.from(totals.entries())
      .map(([key, mins]) => {
        const biz = key === "__personal" ? null : bizById.get(key) ?? null;
        return {
          key,
          label: biz?.name ?? "Personal",
          color: biz?.color ?? "#9aa39a",
          mins,
          pct: (mins / total) * 100,
        };
      })
      .sort((a, b) => b.mins - a.mins);
  }, [events, calById, bizById, rangeStart, rangeEnd]);

  if (segments.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Time split
        </h3>
        <p className="text-xs text-muted-foreground">
          No events in this range yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Time split
      </h3>
      <div className="flex h-2 rounded-full overflow-hidden border border-border">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            title={`${s.label} · ${formatHours(s.mins)}`}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {segments.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between text-xs"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round(s.pct)}% · {formatHours(s.mins)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatHours(mins: number) {
  const h = mins / 60;
  if (h < 1) return `${Math.round(mins)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}
