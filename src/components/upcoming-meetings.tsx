import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Video, Clock, FileText, Loader2 } from "lucide-react";
import { listEvents, listCalendars } from "@/lib/calendars";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { createMeetingFromEvent } from "@/lib/meetings.functions";
import { Button } from "@/components/ui/button";

type Props = {
  /** Days ahead to include (default 7) */
  horizonDays?: number;
  /** Max meetings to show (default 5) */
  limit?: number;
  className?: string;
};

export function UpcomingMeetings({ horizonDays = 7, limit = 5, className }: Props) {
  const { activeId } = useActiveBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + horizonDays);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["upcoming-meetings", now.toDateString(), horizonDays],
    queryFn: () => listEvents(now, end),
  });
  const { data: calendars = [] } = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const calById = new Map(calendars.map((c) => [c.id, c]));

  const createFromEvent = useServerFn(createMeetingFromEvent);
  const prepareMut = useMutation({
    mutationFn: (event_id: string) => createFromEvent({ data: { event_id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      if (res.reused) toast.info("Opening existing meeting note");
      else toast.success("Meeting note prepared");
      navigate({ to: "/meetings/$meetingId", params: { meetingId: res.meeting_id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't prepare meeting"),
  });

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
            const isPending = prepareMut.isPending && prepareMut.variables === m.id;
            return (
              <li
                key={m.id}
                className="group flex items-start gap-3 pl-3 border-l-[3px]"
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs shrink-0 opacity-70 group-hover:opacity-100"
                  onClick={() => prepareMut.mutate(m.id)}
                  disabled={prepareMut.isPending}
                  title="Prepare meeting note"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only sm:not-sr-only sm:ml-1">Prepare note</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
