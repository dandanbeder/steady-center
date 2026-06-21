import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, isSameDay, parseISO } from "date-fns";
import {
  BookOpen,
  Sparkles,
  Plus,
  Lock,
  ShieldCheck,
  ShieldOff,
  Search,
  CalendarDays,
  Download,
  ListOrdered,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { listNotes, createNote, updateNote, type Note } from "@/lib/notes";
import { journalPrefillToday } from "@/lib/notes-journal.functions";
import {
  getJournalLockStatus,
  setJournalLock,
  verifyJournalLock,
  disableJournalLock,
} from "@/lib/journal-lock.functions";
import {
  listJournalMeta,
  upsertJournalMeta,
  hardDeleteJournalEntry,
  REFLECTION_PROMPTS,
  type JournalMeta,
} from "@/lib/journal";
import { generateJournalPdf, type JournalPdfEntry } from "@/lib/journal-pdf";
import { MarkdownEditor, useAutosave } from "@/components/notes/markdown-editor";
import { MoodTagsBar } from "@/components/journal/mood-tags-bar";
import { JournalCalendar } from "@/components/journal/journal-calendar";
import { ReflectionDialog } from "@/components/journal/reflection-dialog";
import { VoiceJournalButton } from "@/components/journal/voice-journal-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getLocalSupportSession } from "@/lib/support-session";

export const Route = createFileRoute("/_authenticated/journal")({
  component: JournalPage,
});

const UNLOCK_KEY = "heartbeat_journal_unlocked";

function JournalPage() {
  const supportSession = getLocalSupportSession();
  const qc = useQueryClient();
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: listNotes });
  const { data: metaRows = [] } = useQuery({
    queryKey: ["journal-meta"],
    queryFn: listJournalMeta,
  });
  const prefillFn = useServerFn(journalPrefillToday);
  const statusFn = useServerFn(getJournalLockStatus);

  const { data: lockStatus } = useQuery({
    queryKey: ["journal-lock"],
    queryFn: () => statusFn({}),
  });

  const [unlocked, setUnlocked] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(UNLOCK_KEY) === "1",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"list" | "calendar">("list");

  const metaByNote = useMemo(() => {
    const m = new Map<string, JournalMeta>();
    for (const r of metaRows) m.set(r.note_id, r);
    return m;
  }, [metaRows]);

  const entries = useMemo(
    () =>
      notes
        .filter((n) => n.note_type === "journal")
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [notes],
  );

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const meta = metaByNote.get(e.id);
      const tagHit = meta?.tags.some((t) => t.includes(q));
      return (
        e.title.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q) ||
        Boolean(tagHit)
      );
    });
  }, [entries, query, metaByNote]);

  const today = new Date();
  const todayEntry = entries.find((e) => isSameDay(parseISO(e.created_at), today));
  const [selectedId, setSelectedId] = useState<string | null>(
    todayEntry?.id ?? entries[0]?.id ?? null,
  );
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const startToday = async (opts: { prefill?: boolean; body?: string; titleHint?: string }) => {
    try {
      let body =
        opts.body ??
        `# ${format(today, "EEEE, MMMM d")}\n\n## What happened today\n- \n\n## What I'm noticing\n- \n\n## What I want tomorrow\n- \n`;
      if (opts.prefill) {
        toast.loading("Drafting from today's activity…", { id: "jp" });
        const res = await prefillFn({ data: {} });
        body = res.markdown;
        toast.dismiss("jp");
      }
      const note = await createNote({
        business_id: null,
        folder_id: null,
        title: opts.titleHint ?? format(today, "MMM d, yyyy"),
        body,
        note_type: "journal",
        source: opts.prefill ? "journal-prefill" : "journal",
      });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setSelectedId(note.id);
    } catch (e) {
      toast.dismiss("jp");
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const pickDate = (d: Date) => {
    const match = entries.find((e) => isSameDay(parseISO(e.created_at), d));
    if (match) {
      setSelectedId(match.id);
      setSidebarTab("list");
    } else {
      toast("No entry that day, and that's okay.", { duration: 2000 });
    }
  };

  const handleExport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      kind: "heartbeat-journal-export",
      entries: entries.map((e) => {
        const m = metaByNote.get(e.id);
        return {
          id: e.id,
          created_at: e.created_at,
          updated_at: e.updated_at,
          title: e.title,
          body: e.body,
          mood: m?.mood ?? null,
          tags: m?.tags ?? [],
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heartbeat-journal-${format(new Date(), "yyyy-MM-dd")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Journal exported");
  };

  if (supportSession) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl text-primary">Journal is private</h1>
          <p className="text-sm text-muted-foreground">
            Journal entries are never visible during admin support sessions.
          </p>
        </div>
      </div>
    );
  }

  if (lockStatus?.enabled && !unlocked) {
    return (
      <UnlockGate
        onUnlocked={() => {
          sessionStorage.setItem(UNLOCK_KEY, "1");
          setUnlocked(true);
        }}
      />
    );
  }

  const entryDates = entries.map((e) => parseISO(e.created_at));

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-80 shrink-0 border-r border-border overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-border space-y-3 sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold">Journal</h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setReflectOpen(true)}
                className="text-muted-foreground hover:text-foreground"
                title="Looking back (AI reflection)"
              >
                <Sparkles className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="text-muted-foreground hover:text-foreground"
                title="Export my journal"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="text-muted-foreground hover:text-foreground"
                title={lockStatus?.enabled ? "Journal is locked" : "Add a lock"}
              >
                {lockStatus?.enabled ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Private to you. Not tied to any account. Never shared.
          </p>

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
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={() => startToday({ prefill: true })}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Draft from today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="w-full gap-1.5"
                onClick={() => startToday({})}
              >
                <Plus className="h-3.5 w-3.5" />
                Blank entry
              </Button>
              <div className="pt-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Start from a prompt
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {REFLECTION_PROMPTS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        startToday({
                          body: `# ${format(today, "EEEE, MMMM d")}\n\n${p.body}`,
                          titleHint: p.label,
                        })
                      }
                      className="text-left text-xs px-2.5 py-1.5 rounded-md border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entries & themes"
              className="h-8 pl-7 text-xs"
            />
          </div>

          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setSidebarTab("list")}
              className={cn(
                "flex-1 px-2 py-1 rounded-md inline-flex items-center justify-center gap-1.5",
                sidebarTab === "list"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ListOrdered className="h-3 w-3" /> Entries
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("calendar")}
              className={cn(
                "flex-1 px-2 py-1 rounded-md inline-flex items-center justify-center gap-1.5",
                sidebarTab === "calendar"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CalendarDays className="h-3 w-3" /> Calendar
            </button>
          </div>
        </div>

        {sidebarTab === "list" ? (
          <div className="p-2 space-y-1">
            {filteredEntries.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8 px-4">
                {query
                  ? "No entries match that search."
                  : "No entries yet. Start when you feel like it, there's no streak to break."}
              </p>
            )}
            {filteredEntries.map((e) => {
              const d = parseISO(e.created_at);
              const meta = metaByNote.get(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-lg transition-colors",
                    selectedId === e.id ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <div className="text-sm font-medium truncate">
                    {format(d, "EEE, MMM d")}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {format(d, "yyyy")}
                  </div>
                  {meta && (meta.tags.length > 0 || meta.mood) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {meta.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-background border border-border/60 text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <JournalCalendar entryDates={entryDates} onPick={pickDate} />
        )}
      </aside>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <JournalEditor
            key={selected.id}
            note={selected}
            meta={metaByNote.get(selected.id) ?? null}
            onChanged={() => qc.invalidateQueries({ queryKey: ["notes"] })}
            onMetaChanged={() => qc.invalidateQueries({ queryKey: ["journal-meta"] })}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 max-w-md mx-auto">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              A gentle place for daily reflection. Use the buttons on the left to start when you're
              ready.
            </p>
          </div>
        )}
      </div>

      <LockSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        enabled={Boolean(lockStatus?.enabled)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["journal-lock"] })}
      />
      <ReflectionDialog open={reflectOpen} onOpenChange={setReflectOpen} />
    </div>
  );
}

function JournalEditor({
  note,
  meta,
  onChanged,
  onMetaChanged,
}: {
  note: Note;
  meta: JournalMeta | null;
  onChanged: () => void;
  onMetaChanged: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [title, setTitle] = useState(note.title);
  const [mood, setMood] = useState<number | null>(meta?.mood ?? null);
  const [tags, setTags] = useState<string[]>(meta?.tags ?? []);

  const { savedAt, saving } = useAutosave({ body, title }, async (v) => {
    await updateNote(note.id, { body: v.body, title: v.title });
    onChanged();
  });

  // Persist meta separately, lightly debounced.
  useEffect(() => {
    const initialMood = meta?.mood ?? null;
    const initialTags = meta?.tags ?? [];
    if (
      mood === initialMood &&
      tags.length === initialTags.length &&
      tags.every((t, i) => t === initialTags[i])
    ) {
      return;
    }
    const handle = setTimeout(() => {
      upsertJournalMeta({ note_id: note.id, mood, tags })
        .then(onMetaChanged)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save mood/tags"));
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, tags, note.id]);

  const insertTranscript = (text: string) => {
    setBody((prev) => {
      const sep = prev.endsWith("\n") || prev.length === 0 ? "" : "\n\n";
      return `${prev}${sep}${text}`;
    });
    toast.success("Added to entry.");
  };

  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-10 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {saving ? "Saving…" : savedAt ? "Saved" : "Edited"}
        </div>
        <VoiceJournalButton onTranscribed={insertTranscript} />
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-2xl font-serif border-none px-0 focus-visible:ring-0 shadow-none h-auto py-1"
        placeholder="Entry title"
      />
      <MoodTagsBar
        mood={mood}
        tags={tags}
        onChange={(next) => {
          setMood(next.mood);
          setTags(next.tags);
        }}
      />
      <MarkdownEditor value={body} onChange={setBody} />
    </div>
  );
}

function UnlockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const verifyFn = useServerFn(verifyJournalLock);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin) return;
    setBusy(true);
    try {
      const res = await verifyFn({ data: { pin } });
      if (res.ok) {
        onUnlocked();
      } else {
        toast.error("Incorrect PIN");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById("journal-pin");
      el?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-medium">Journal is locked</h1>
          <p className="text-sm text-muted-foreground">
            Enter your PIN or passphrase to unlock this device session.
          </p>
        </div>
        <Input
          id="journal-pin"
          type="password"
          inputMode="text"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="PIN or passphrase"
          className="text-center"
        />
        <Button onClick={submit} disabled={busy || !pin} className="w-full">
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </div>
    </div>
  );
}

function LockSettingsDialog({
  open,
  onOpenChange,
  enabled,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  enabled: boolean;
  onChanged: () => void;
}) {
  const setFn = useServerFn(setJournalLock);
  const disableFn = useServerFn(disableJournalLock);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    }
  }, [open]);

  const handleSet = async () => {
    if (newPin.length < 4) {
      toast.error("PIN must be at least 4 characters");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PINs don't match");
      return;
    }
    setBusy(true);
    try {
      await setFn({ data: { pin: newPin, currentPin: enabled ? currentPin : undefined } });
      toast.success(enabled ? "PIN updated" : "Journal lock enabled");
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!currentPin) {
      toast.error("Enter your current PIN");
      return;
    }
    setBusy(true);
    try {
      await disableFn({ data: { pin: currentPin } });
      sessionStorage.removeItem(UNLOCK_KEY);
      toast.success("Journal lock removed");
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {enabled ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {enabled ? "Journal lock" : "Add a Journal lock"}
          </DialogTitle>
          <DialogDescription>
            A PIN or passphrase that keeps your Journal closed even on an unlocked screen. Asked
            once per device session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {enabled && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Current PIN</label>
              <Input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              {enabled ? "New PIN" : "PIN or passphrase"}
            </label>
            <Input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="At least 4 characters"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Confirm</label>
            <Input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {enabled && (
            <Button
              variant="ghost"
              onClick={handleDisable}
              disabled={busy}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <ShieldOff className="h-4 w-4" />
              Remove lock
            </Button>
          )}
          <Button onClick={handleSet} disabled={busy}>
            {busy ? "Saving…" : enabled ? "Update PIN" : "Enable lock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
