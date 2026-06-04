import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listBusinesses } from "@/lib/businesses";
import { listFolders, createFolder, createList, listLists, createTask } from "@/lib/tasks";
import { createNote } from "@/lib/notes";
import { parseVoiceCapture } from "@/lib/voice.functions";
import { cn } from "@/lib/utils";

type Phase = "idle" | "listening" | "thinking" | "review";

type Parsed = {
  business: string | null;
  folder: string | null;
  note_title: string;
  note_body: string;
  follow_up: { title: string | null; due_at: string | null };
};

// Web Speech API typings
type SR = any;
function getSpeechRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function TalkButton() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [businessId, setBusinessId] = useState<string | "none">("none");
  const [folderName, setFolderName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpDue, setFollowUpDue] = useState("");
  const [saving, setSaving] = useState(false);

  const recogRef = useRef<any>(null);
  const qc = useQueryClient();
  const parseVoice = useServerFn(parseVoiceCapture);

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });

  // reset on close
  useEffect(() => {
    if (!open) {
      try {
        recogRef.current?.stop?.();
      } catch {}
      recogRef.current = null;
      setPhase("idle");
      setTranscript("");
      setInterim("");
      setParsed(null);
      setSaving(false);
    }
  }, [open]);

  const startListening = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      toast.error("Your browser doesn't support speech recognition. Try Chrome or Edge.");
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    let finalText = "";
    r.onresult = (e: any) => {
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interimChunk += t;
      }
      setTranscript(finalText.trim());
      setInterim(interimChunk);
    };
    r.onerror = (e: any) => {
      toast.error(`Speech error: ${e.error ?? "unknown"}`);
      setPhase("idle");
    };
    r.onend = () => {
      // user-driven stop handled in stopListening
    };
    recogRef.current = r;
    r.start();
    setPhase("listening");
  };

  const stopListening = async () => {
    try {
      recogRef.current?.stop?.();
    } catch {}
    const finalText = (transcript + " " + interim).trim();
    setInterim("");
    if (!finalText) {
      toast.error("Didn't catch anything. Try again.");
      setPhase("idle");
      return;
    }
    setTranscript(finalText);
    setPhase("thinking");
    try {
      const result = (await parseVoice({
        data: {
          transcript: finalText,
          businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
          now: new Date().toISOString(),
        },
      })) as Parsed;
      setParsed(result);
      // prefill
      const matched = businesses.find(
        (b) => b.name.toLowerCase() === (result.business ?? "").toLowerCase(),
      );
      setBusinessId(matched ? matched.id : "none");
      setFolderName(result.folder ?? "");
      setTitle(result.note_title);
      setBody(result.note_body);
      setFollowUpTitle(result.follow_up.title ?? "");
      setFollowUpDue(result.follow_up.due_at ? result.follow_up.due_at.slice(0, 10) : "");
      setPhase("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to process");
      setPhase("idle");
    }
  };

  const confirm = async () => {
    setSaving(true);
    try {
      const biz = businessId === "none" ? null : businessId;

      // Find or create folder (within selected business) if a name is provided
      let folderId: string | null = null;
      if (biz && folderName.trim()) {
        const existing = folders.find(
          (f) =>
            f.business_id === biz &&
            f.name.toLowerCase() === folderName.trim().toLowerCase(),
        );
        if (existing) {
          folderId = existing.id;
        } else {
          await createFolder({ business_id: biz, name: folderName.trim() });
          const fresh = await qc.fetchQuery({ queryKey: ["folders"], queryFn: listFolders });
          folderId =
            fresh.find(
              (f) =>
                f.business_id === biz &&
                f.name.toLowerCase() === folderName.trim().toLowerCase(),
            )?.id ?? null;
        }
      }

      await createNote({
        business_id: biz,
        folder_id: folderId,
        title: title.trim() || "Untitled note",
        body,
        source: "voice",
      });

      if (followUpTitle.trim() && biz) {
        // Ensure a folder + list exist to attach the task to
        let taskFolderId = folderId;
        if (!taskFolderId) {
          const inbox = folders.find(
            (f) => f.business_id === biz && f.name.toLowerCase() === "inbox",
          );
          if (inbox) {
            taskFolderId = inbox.id;
          } else {
            await createFolder({ business_id: biz, name: "Inbox" });
            const fresh = await qc.fetchQuery({ queryKey: ["folders"], queryFn: listFolders });
            taskFolderId =
              fresh.find(
                (f) => f.business_id === biz && f.name.toLowerCase() === "inbox",
              )?.id ?? null;
          }
        }
        if (taskFolderId) {
          const lists = await qc.fetchQuery({ queryKey: ["lists"], queryFn: listLists });
          let list = lists.find((l) => l.folder_id === taskFolderId);
          if (!list) {
            await createList({ folder_id: taskFolderId, name: "Tasks" });
            const refreshed = await qc.fetchQuery({ queryKey: ["lists"], queryFn: listLists });
            list = refreshed.find((l) => l.folder_id === taskFolderId);
          }
          if (list) {
            const due = followUpDue ? new Date(followUpDue).toISOString() : null;
            await createTask({
              list_id: list.id,
              business_id: biz,
              title: followUpTitle.trim(),
              due_at: due,
            });
          }
        }
      } else if (followUpTitle.trim() && !biz) {
        toast.message("Follow-up skipped — pick an account to file it under.");
      }

      qc.invalidateQueries();
      toast.success("Saved");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const liveText = (transcript + " " + interim).trim();

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          // start listening immediately
          setTimeout(() => startListening(), 50);
        }}
        className={cn(
          "fixed right-6 z-40 h-14 w-14 rounded-full",
          "bg-accent text-accent-foreground shadow-lg",
          "flex items-center justify-center transition-transform hover:scale-105",
        )}
        aria-label="Talk to Heartbeat"
        style={{
          bottom: "max(1.5rem, env(safe-area-inset-bottom))",
          boxShadow: "var(--shadow-elegant, 0 10px 30px -10px rgba(0,0,0,0.25))",
        }}
      >
        <Mic className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {phase === "listening" && "Listening…"}
              {phase === "thinking" && "Making sense of it…"}
              {phase === "review" && "Confirm note"}
              {phase === "idle" && "Talk"}
            </DialogTitle>
            <DialogDescription>
              {phase === "listening" && "Speak naturally. Press stop when you're done."}
              {phase === "review" && "Review and adjust before saving. Nothing is saved without your confirmation."}
            </DialogDescription>
          </DialogHeader>

          {(phase === "listening" || phase === "thinking") && (
            <div className="space-y-4">
              <div className="min-h-[120px] rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
                {liveText || (
                  <span className="text-muted-foreground italic">Waiting for words…</span>
                )}
                {phase === "listening" && interim && (
                  <span className="text-muted-foreground"> {interim}</span>
                )}
              </div>
              {phase === "listening" ? (
                <Button onClick={stopListening} variant="default" className="w-full gap-2">
                  <Square className="h-4 w-4" /> Stop and process
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          )}

          {phase === "review" && parsed && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Account</Label>
                  <Select value={businessId} onValueChange={(v) => setBusinessId(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No account</SelectItem>
                      {businesses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Folder</Label>
                  <Input
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    placeholder="e.g. Sales"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
              </div>
              <div className="rounded-lg border border-dashed p-3 space-y-3">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Follow-up task
                </Label>
                <Input
                  value={followUpTitle}
                  onChange={(e) => setFollowUpTitle(e.target.value)}
                  placeholder="No follow-up"
                />
                <Input
                  type="date"
                  value={followUpDue}
                  onChange={(e) => setFollowUpDue(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {phase === "review" && (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={confirm} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
