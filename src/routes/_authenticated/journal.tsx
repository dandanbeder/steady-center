import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, isSameDay, parseISO } from "date-fns";
import { BookOpen, Sparkles, Plus } from "lucide-react";
import { toast } from "sonner";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { listNotes, createNote, updateNote, type Note } from "@/lib/notes";
import { journalPrefillToday } from "@/lib/notes-journal.functions";
import { MarkdownEditor, useAutosave } from "@/components/notes/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getLocalSupportSession } from "@/lib/support-session";

export const Route = createFileRoute("/_authenticated/journal")({
  component: JournalPage,
});

function JournalPage() {
  const supportSession = getLocalSupportSession();
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: listNotes });
  const prefillFn = useServerFn(journalPrefillToday);

  const entries = useMemo(() => {
    let out = notes.filter((n) => n.note_type === "journal");
    if (activeId !== ALL) out = out.filter((n) => n.business_id === activeId);
    return out.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [notes, activeId]);

  const today = new Date();
  const todayEntry = entries.find((e) => isSameDay(parseISO(e.created_at), today));
  const [selectedId, setSelectedId] = useState<string | null>(
    todayEntry?.id ?? entries[0]?.id ?? null,
  );
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const startToday = async (prefill: boolean) => {
    const targetBiz =
      activeId !== ALL ? activeId : businesses[0]?.id ?? null;
    if (!targetBiz) {
      toast.error("Create an account first.");
      return;
    }
    try {
      let body = `# ${format(today, "EEEE, MMMM d")}\n\n## What happened today\n- \n\n## What I'm noticing\n- \n\n## What I want tomorrow\n- \n`;
      if (prefill) {
        toast.loading("Drafting from today's activity…", { id: "jp" });
        const res = await prefillFn({ data: { businessId: targetBiz } });
        body = res.markdown;
        toast.dismiss("jp");
      }
      const note = await createNote({
        business_id: targetBiz,
        folder_id: null,
        title: format(today, "MMM d, yyyy"),
        body,
        note_type: "journal",
        source: prefill ? "journal-prefill" : "journal",
      });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setSelectedId(note.id);
    } catch (e) {
      toast.dismiss("jp");
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  if (supportSession) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl text-primary">Journal is private</h1>
          <p className="text-sm text-muted-foreground">
            Journal entries are not available during admin support sessions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-72 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border space-y-2 sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Journal</h1>
          </div>
          {todayEntry ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setSelectedId(todayEntry.id)}
            >
              Open today's entry
            </Button>
          ) : (
            <div className="space-y-1.5">
              <Button size="sm" className="w-full gap-1.5" onClick={() => startToday(true)}>
                <Sparkles className="h-3.5 w-3.5" />
                Draft from today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="w-full gap-1.5"
                onClick={() => startToday(false)}
              >
                <Plus className="h-3.5 w-3.5" />
                Blank entry
              </Button>
            </div>
          )}
        </div>
        <div className="p-2 space-y-1">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8 px-4">
              No entries yet. Start when you feel like it — there's no streak to break.
            </p>
          )}
          {entries.map((e) => {
            const d = parseISO(e.created_at);
            return (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  "w-full text-left p-2.5 rounded-lg transition-colors",
                  selectedId === e.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <div className="text-sm font-medium">{format(d, "EEE, MMM d")}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {format(d, "yyyy")}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <JournalEditor key={selected.id} note={selected} onChanged={() => qc.invalidateQueries({ queryKey: ["notes"] })} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 max-w-md mx-auto">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              A gentle place for daily reflection. Use the buttons on the left to start when you're ready.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function JournalEditor({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const [body, setBody] = useState(note.body);
  const [title, setTitle] = useState(note.title);
  const { savedAt, saving } = useAutosave(
    { body, title },
    async (v) => {
      await updateNote(note.id, { body: v.body, title: v.title });
      onChanged();
    },
  );
  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-10 space-y-4">
      <div className="text-xs text-muted-foreground">
        {saving ? "Saving…" : savedAt ? `Saved` : "Edited"}
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-2xl font-serif border-none px-0 focus-visible:ring-0 shadow-none h-auto py-1"
        placeholder="Entry title"
      />
      <MarkdownEditor value={body} onChange={setBody} />
    </div>
  );
}
