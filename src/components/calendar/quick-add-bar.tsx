import { useState } from "react";
import * as chrono from "chrono-node";
import { Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createEvent, type Calendar as Cal } from "@/lib/calendars";

/**
 * Quick-add bar: natural-language event creation via chrono-node.
 * Parses phrases like "Coffee with Sam Friday 9am", "Standup tomorrow 10-10:30",
 * "Block focus Wed 2pm for 90 min".
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

  const parsed = parse(text);

  async function submit() {
    if (!text.trim()) return;
    if (!calId) {
      toast.error("Pick a calendar first");
      return;
    }
    const result = parse(text);
    if (!result) {
      toast.error("Couldn't read a date or time — try 'Coffee tomorrow 9am'");
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

  return (
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
        placeholder='Quick add — e.g. "Coffee with Sam Friday 9am"'
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
  // Determine "all day" — no hour component implied
  const hasHour = r.start.isCertain("hour") || r.start.isCertain("minute");
  let end: Date;
  if (r.end) {
    end = r.end.date();
  } else if (hasHour) {
    // Look for "for 90 min" / "for 2 hours"
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
    // All-day → end-of-day
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  }
  // Title = original text with date phrase removed
  const matched = r.text;
  let title = text.replace(matched, "").replace(/\s+/g, " ").trim();
  // Strip leading prepositions left behind ("at", "on", "from")
  title = title.replace(/\b(at|on|from|for)\b\s*$/i, "").trim();
  if (!title) title = "Untitled";
  return { title, start, end, allDay: !hasHour };
}

function previewLabel(p: Parsed) {
  const sameDay =
    p.start.toDateString() === p.end.toDateString();
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
