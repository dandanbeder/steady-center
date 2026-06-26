import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Network,
  Briefcase,
  Users,
  Target,
  CheckSquare,
  Calendar as CalendarIcon,
  FileText,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listLinksFrom, listBacklinks, resolveLinks } from "@/lib/note-links";
import { listBusinesses } from "@/lib/businesses";
import type { Note } from "@/lib/notes";

/**
 * Reverse / at-a-glance view of everything connected to this note:
 * account, source meeting, linked outcome(s), linked tasks (source + outward).
 * Any item the user can't see via RLS simply doesn't appear — no silent leak.
 */
export function LinkedOverviewPanel({ note }: { note: Note }) {
  // Account (the user's own businesses list — RLS already scopes it).
  const accountQ = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const account =
    note.business_id && accountQ.data?.find((b) => b.id === note.business_id);

  // Tasks created from / linked back to this note.
  const tasksQ = useQuery({
    queryKey: ["note-overview-tasks", note.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,status")
        .eq("source_note_id", note.id)
        .is("deleted_at", null)
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string; status: string }>;
    },
  });

  // Source meeting (if the note was created from a meeting).
  const meetingQ = useQuery({
    queryKey: ["note-overview-meeting", note.linked_meeting_id],
    enabled: !!note.linked_meeting_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("meetings")
        .select("id,title")
        .eq("id", note.linked_meeting_id!)
        .maybeSingle();
      return data;
    },
  });

  // Outward and inward links — used to surface outcomes the note supports
  // (outward) or pages that reference this note (inward).
  const outwardQ = useQuery({
    queryKey: ["note-links", note.id],
    queryFn: async () => resolveLinks(await listLinksFrom(note.id)),
  });
  const backQ = useQuery({
    queryKey: ["note-backlinks-overview", note.id],
    queryFn: async () => resolveLinks(await listBacklinks("note", note.id)),
  });

  const outcomes = (outwardQ.data ?? []).filter((l) => l.to_type === "outcome");
  const linkedMeetings = (outwardQ.data ?? []).filter((l) => l.to_type === "meeting");
  const linkedEvents = (outwardQ.data ?? []).filter((l) => l.to_type === "event");
  const backNotes = backQ.data ?? [];
  const tasks = tasksQ.data ?? [];

  const isEmpty =
    !account &&
    !note.linked_meeting_id &&
    !note.linked_event_id &&
    outcomes.length === 0 &&
    linkedMeetings.length === 0 &&
    linkedEvents.length === 0 &&
    tasks.length === 0 &&
    backNotes.length === 0;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Network className="h-3.5 w-3.5" /> Linked
      </h3>

      {isEmpty && (
        <p className="text-xs text-muted-foreground">Nothing connected yet.</p>
      )}

      {/* Account */}
      <Row icon={Briefcase} label="Account">
        <span className="inline-flex items-center gap-1.5">
          {account ? (
            <>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: account.color || "var(--muted-foreground)" }}
              />
              {account.name}
            </>
          ) : (
            <span className="text-muted-foreground italic">Personal · Uncategorised</span>
          )}
        </span>
      </Row>

      {/* Source meeting */}
      {note.linked_meeting_id && (
        <Row icon={Users} label="From meeting">
          <Link
            to="/meetings/$meetingId"
            params={{ meetingId: note.linked_meeting_id }}
            className="text-primary hover:underline inline-flex items-center gap-1 truncate"
          >
            {meetingQ.data?.title ?? "Open meeting"}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
        </Row>
      )}

      {/* Outcomes */}
      {outcomes.map((o) => (
        <Row key={o.id} icon={Target} label="Outcome">
          {o.href ? (
            <Link to={o.href} className="text-primary hover:underline truncate">
              {o.label}
            </Link>
          ) : (
            <span className="text-muted-foreground italic">{o.label}</span>
          )}
        </Row>
      ))}

      {/* Linked tasks summary */}
      {tasks.length > 0 && (
        <Row icon={CheckSquare} label="Tasks">
          <Link to="/tasks" className="text-primary hover:underline">
            {tasks.filter((t) => t.status !== "done").length} open · {tasks.length} total
          </Link>
        </Row>
      )}

      {/* Additional outward calendar/meeting links beyond the source */}
      {linkedMeetings.map((m) => (
        <Row key={m.id} icon={Users} label="Meeting">
          {m.href ? (
            <Link to={m.href} className="text-primary hover:underline truncate">
              {m.label}
            </Link>
          ) : (
            <span className="text-muted-foreground italic">{m.label}</span>
          )}
        </Row>
      ))}
      {(note.linked_event_id || linkedEvents.length > 0) && (
        <Row icon={CalendarIcon} label="Event">
          <Link to="/calendar" className="text-primary hover:underline">
            Open in calendar
          </Link>
        </Row>
      )}

      {/* Inbound: other notes that link here */}
      {backNotes.length > 0 && (
        <Row icon={FileText} label="Referenced by">
          <Link to="/notes" className="text-primary hover:underline">
            {backNotes.length} note{backNotes.length === 1 ? "" : "s"}
          </Link>
        </Row>
      )}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Briefcase;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <div className="flex-1 min-w-0 truncate">{children}</div>
    </div>
  );
}
