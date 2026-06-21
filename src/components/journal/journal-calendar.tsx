import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  entryDates: Date[];
  onPick: (d: Date) => void;
};

export function JournalCalendar({ entryDates, onPick }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const written = useMemo(() => {
    const s = new Set<string>();
    for (const d of entryDates) s.add(format(d, "yyyy-MM-dd"));
    return s;
  }, [entryDates]);

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="text-xs font-medium">{format(cursor, "MMMM yyyy")}</div>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const inMonth = isSameMonth(d, cursor);
          const wrote = written.has(format(d, "yyyy-MM-dd"));
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                "aspect-square text-[11px] rounded-md grid place-items-center transition-colors",
                !inMonth && "text-muted-foreground/40",
                inMonth && !wrote && "hover:bg-muted text-muted-foreground",
                wrote && "bg-primary/15 text-foreground hover:bg-primary/25",
                isToday(d) && "ring-1 ring-primary/50",
              )}
              title={wrote ? "Entry written" : ""}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center pt-1">
        Filled days are entries. No streaks. No pressure.
      </p>
    </div>
  );
  void isSameDay;
}
