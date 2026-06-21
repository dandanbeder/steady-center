import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, isSameDay, parseISO } from "date-fns";
import { BookOpen, Sparkles, Plus, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { listNotes, createNote, updateNote, type Note } from "@/lib/notes";
import { journalPrefillToday } from "@/lib/notes-journal.functions";
import {
  getJournalLockStatus,
  setJournalLock,
  verifyJournalLock,
  disableJournalLock,
} from "@/lib/journal-lock.functions";
import { MarkdownEditor, useAutosave } from "@/components/notes/markdown-editor";
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

  // Journal is private + personal — no account scoping at all.
  const entries = useMemo(
    () =>
      notes
        .filter((n) => n.note_type === "journal")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [notes],
  );

  const today = new Date();
  const todayEntry = entries.find((e) => isSameDay(parseISO(e.created_at), today));
  const [selectedId, setSelectedId] = useState<string | null>(
    todayEntry?.id ?? entries[0]?.id ?? null,
  );
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const startToday = async (prefill: boolean) => {
    try {
      let body = `# ${format(today, "EEEE, MMMM d")}\n\n## What happened today\n- \n\n## What I'm noticing\n- \n\n## What I want tomorrow\n- \n`;
      if (prefill) {
        toast.loading("Drafting from today's activity…", { id: "jp" });
        const res = await prefillFn({ data: {} });
        body = res.markdown;
        toast.dismiss("jp");
      }
      const note = await createNote({
        business_id: null, // Journal is always personal
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-72 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border space-y-2 sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold">Journal</h1>
            </div>
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
          <JournalEditor
            key={selected.id}
            note={selected}
            onChanged={() => qc.invalidateQueries({ queryKey: ["notes"] })}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 max-w-md mx-auto">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              A gentle place for daily reflection. Use the buttons on the left to start when you're ready.
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
            A PIN or passphrase that keeps your Journal closed even on an unlocked screen.
            Asked once per device session.
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
