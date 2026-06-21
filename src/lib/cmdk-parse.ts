import * as chrono from "chrono-node";

export type ParsedQuickAdd = {
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
};

/** Parse a free-text command line into a title + optional date/time hint. */
export function parseQuickAdd(input: string): ParsedQuickAdd {
  const text = input.trim();
  if (!text) return { title: "", start: null, end: null, allDay: false };
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length === 0) {
    return { title: text, start: null, end: null, allDay: false };
  }
  const r = results[0];
  const start = r.start.date();
  const hasHour = r.start.isCertain("hour") || r.start.isCertain("minute");
  let end: Date;
  if (r.end) end = r.end.date();
  else if (hasHour) {
    const dur = text.match(/for\s+(\d+)\s*(min|mins|minutes|h|hr|hour|hours)\b/i);
    if (dur) {
      const n = parseInt(dur[1], 10);
      const mins = dur[2].toLowerCase().startsWith("h") ? n * 60 : n;
      end = new Date(start.getTime() + mins * 60_000);
    } else {
      end = new Date(start.getTime() + 60 * 60_000);
    }
  } else {
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  }
  let title = text.replace(r.text, "").replace(/\s+/g, " ").trim();
  title = title.replace(/\b(at|on|from|for|by)\b\s*$/i, "").trim();
  if (!title) title = text;
  return { title, start, end, allDay: !hasHour };
}

export function formatDateHint(d: Date, allDay: boolean): string {
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `${date} (all day)`;
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} ${t}`;
}
