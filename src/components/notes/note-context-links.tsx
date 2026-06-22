import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Users, ExternalLink, Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { listCalendars, createEvent } from "@/lib/calendars";
import { updateNote, type Note } from "@/lib/notes";
import { createLink } from "@/lib/note-links";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function defaultDate() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function NoteContextLinks({
  note,
  onChanged,
}: {
  note: Note;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const meetingQ = useQuery({
    queryKey: ["note-linked-meeting", note.linked_meeting_id],
    enabled: !!note.linked_meeting_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("id,title")
        .eq("id", note.linked_meeting_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const eventQ = useQuery({
    queryKey: ["note-linked-event", note.linked_event_id],
    enabled: !!note.linked_event_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id,title,start_at")
        .eq("id", note.linked_event_id!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const detach = useMutation({
    mutationFn: async (kind: "meeting" | "event") => {
      await updateNote(note.id, kind === "meeting" ? { linked_meeting_id: null } : { linked_event_id: null });
    },
    onSuccess: () => {
      onChanged();
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  const hasAny = note.linked_meeting_id || note.linked_event_id;

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <CalendarIcon className="h-3.5 w-3.5" /> Linked to
      </h3>
      {!hasAny && (
        <p className="text-xs text-muted-foreground">
          Not linked to a meeting or calendar event.
        </p>
      )}
      {note.linked_meeting_id && (
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <Link
            to="/meetings/$meetingId"
            params={{ meetingId: note.linked_meeting_id }}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {meetingQ.data?.title ?? "Open meeting"}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
          <button
            onClick={() => detach.mutate("meeting")}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Unlink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {note.linked_event_id && (
        <div className="flex items-center gap-2 text-sm">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <Link
            to="/calendar"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {eventQ.data?.title ?? "Open event"}
            {eventQ.data?.start_at && (
              <span className="text-xs text-muted-foreground">
                · {new Date(eventQ.data.start_at).toLocaleString()}
              </span>
            )}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
          <button
            onClick={() => detach.mutate("event")}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Unlink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="pt-1">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create calendar event
        </Button>
      </div>

      <CreateEventFromNoteDialog
        open={open}
        onClose={() => setOpen(false)}
        note={note}
        onCreated={() => {
          onChanged();
          qc.invalidateQueries({ queryKey: ["note-links", note.id] });
        }}
      />
    </div>
  );
}

function CreateEventFromNoteDialog({
  open,
  onClose,
  note,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  note: Note;
  onCreated: () => void;
}) {
  const initial = useMemo(() => {
    const d = defaultDate();
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      start: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      end: `${pad(d.getHours() + 1)}:${pad(d.getMinutes())}`,
    };
  }, [open]);

  const [title, setTitle] = useState(note.title || "Untitled note");
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [calendarId, setCalendarId] = useState<string>("");

  const calsQ = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const cals = calsQ.data ?? [];
  const matching = note.business_id
    ? cals.filter((c) => c.business_id === note.business_id)
    : cals;
  const defaultCal = (matching[0] ?? cals[0])?.id ?? "";
  const effectiveCal = calendarId || defaultCal;

  const create = useMutation({
    mutationFn: async () => {
      if (!effectiveCal) throw new Error("Add a calendar first");
      const startIso = new Date(`${date}T${start}:00`).toISOString();
      const endIso = new Date(`${date}T${end}:00`).toISOString();
      if (new Date(endIso) <= new Date(startIso)) throw new Error("End must be after start");
      const ev = await createEvent({
        calendar_id: effectiveCal,
        business_id: note.business_id,
        title: title.trim() || "Untitled",
        description: note.body.slice(0, 2000),
        location: null,
        start_at: startIso,
        end_at: endIso,
        all_day: false,
      });
      // Two-way link: set note.linked_event_id + drop note_links row.
      await updateNote(note.id, { linked_event_id: ev.id });
      if (note.business_id) {
        try {
          await createLink({
            from_note_id: note.id,
            business_id: note.business_id,
            to_type: "event",
            to_id: ev.id,
          });
        } catch {
          /* non-fatal */
        }
      }
      return ev;
    },
    onSuccess: () => {
      toast.success("Event created and linked");
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create event from note</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Calendar</Label>
            <Select value={effectiveCal} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a calendar" />
              </SelectTrigger>
              <SelectContent>
                {cals.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            The event will link back to this note; the note's "Linked to" section will show the event.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="gap-1.5">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
