import { useQuery } from "@tanstack/react-query";
import { Video, Clock } from "lucide-react";
import { listEvents, listCalendars } from "@/lib/calendars";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";

type Props = {
  /** Days ahead to include (default 7) */
  horizonDays?: number;
  /** Max meetings to show (default 5) */
  limit?: number;
  className?: string;
};

export function UpcomingMeetings({ horizonDays = 7, limit = 5, className }: Props) {
  const { activeId } = useActiveBusiness();
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + horizonDays);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["upcoming-meetings", now.toDateString(), horizonDays],
    queryFn: () => listEvents(now, end),
  });
  const { data: calendars = [] } = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const calById = new Map(calendars.map((c) => [c.id, c]));

  const meetings = events
    .filter((e) => e.is_meeting)
    .filter((e) => activeId === ALL || e.business_id === activeId)
    .filter((e) => new Date(e.start_at).getTime() >= now.getTime())
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, limit);

  return (
    <div className={className}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming meetings.</p>
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => {
            const c = calById.get(m.calendar_id);
            const start = new Date(m.start_at);
            const sameDay = start.toDateString() === now.toDateString();
            return (
              <li
                key={m.id}
                className="flex items-start gap-3 pl-3 border-l-[3px]"
                style={{ borderColor: c?.color ?? "var(--accent)" }}
              >
                <Video className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {sameDay
                      ? start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                      : start.toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                    {c && <> · {c.name}</>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
