import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { createNote, type Note } from "@/lib/notes";
import { createLink } from "@/lib/note-links";

type LinkedNote = Pick<Note, "id" | "title" | "updated_at">;

async function listNotesForMeeting(meetingId: string): Promise<LinkedNote[]> {
  // Direct column linkage (primary).
  const direct = await supabase
    .from("notes")
    .select("id,title,updated_at")
    .eq("linked_meeting_id", meetingId)
    .is("deleted_at", null);
  if (direct.error) throw direct.error;

  // Plus anything wired through note_links (e.g. attached after the fact).
  const indirect = await supabase
    .from("note_links")
    .select("from_note_id")
    .eq("to_type", "meeting")
    .eq("to_id", meetingId);
  if (indirect.error) throw indirect.error;

  const ids = (indirect.data ?? []).map((r) => r.from_note_id);
  let extra: LinkedNote[] = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("notes")
      .select("id,title,updated_at")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    extra = (data ?? []) as LinkedNote[];
  }

  const seen = new Set<string>();
  const all = [...((direct.data ?? []) as LinkedNote[]), ...extra].filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  all.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return all;
}

export function MeetingNotesPanel({
  meeting,
}: {
  meeting: {
    id: string;
    title: string;
    business_id: string | null;
    summary: string;
    transcript: string;
    scheduled_at: string | null;
    created_at: string;
  };
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: notes = [] } = useQuery({
    queryKey: ["meeting-notes", meeting.id],
    queryFn: () => listNotesForMeeting(meeting.id),
  });

  const create = useMutation({
    mutationFn: async () => {
      setCreating(true);
      const when = meeting.scheduled_at ?? meeting.created_at;
      const lines: string[] = [];
      lines.push(`> From meeting on ${new Date(when).toLocaleString()}.`);
      lines.push("");
      if (meeting.summary?.trim()) {
        lines.push("## Summary");
        lines.push(meeting.summary.trim());
        lines.push("");
      }
      if (meeting.transcript?.trim()) {
        lines.push("## Transcript");
        lines.push(meeting.transcript.trim());
        lines.push("");
      }
      if (!meeting.summary && !meeting.transcript) {
        lines.push("_Add your notes for this meeting here._");
      }
      const note = await createNote({
        business_id: meeting.business_id,
        folder_id: null,
        title: `Notes, ${meeting.title}`,
        body: lines.join("\n"),
        source: "meeting",
        linked_meeting_id: meeting.id,
      });
      // Two-way: also drop a note_links row so the note's Connections panel
      // shows the meeting on its side.
      if (meeting.business_id) {
        try {
          await createLink({
            from_note_id: note.id,
            business_id: meeting.business_id,
            to_type: "meeting",
            to_id: meeting.id,
          });
        } catch {
          /* non-fatal */
        }
      }
      return note;
    },
    onSuccess: () => {
      toast.success("Meeting note created");
      qc.invalidateQueries({ queryKey: ["meeting-notes", meeting.id] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
    onSettled: () => setCreating(false),
  });

  return (
    <section className="border-t border-border pt-4 mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-4 w-4" /> Notes
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => create.mutate()}
          disabled={creating || create.isPending}
          className="gap-1.5"
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create meeting note
        </Button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No notes linked to this meeting yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                to="/notes"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                {n.title || "Untitled"}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        Linked notes carry this meeting's summary and transcript and link back here.
      </p>
    </section>
  );
}
