import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { captureToInbox } from "@/lib/inbox";
import { suggestInboxItem } from "@/lib/inbox-ai.functions";
import { cn } from "@/lib/utils";

type Phase = "idle" | "listening" | "saving";

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

  const recogRef = useRef<any>(null);
  const qc = useQueryClient();
  const suggest = useServerFn(suggestInboxItem);

  useEffect(() => {
    if (!open) {
      try { recogRef.current?.stop?.(); } catch {}
      recogRef.current = null;
      setPhase("idle");
      setTranscript("");
      setInterim("");
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
    recogRef.current = r;
    r.start();
    setPhase("listening");
  };

  const captureNow = async (text: string) => {
    setPhase("saving");
    try {
      const item = await captureToInbox({ raw_text: text, source: "voice" });
      suggest({ data: { inbox_id: item.id, now: new Date().toISOString() } })
        .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }))
        .catch(() => {});
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", "count"] });
      toast.success("Captured to Inbox", { description: "Triage when ready." });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to capture");
      setPhase("idle");
    }
  };

  const stopListening = async () => {
    try { recogRef.current?.stop?.(); } catch {}
    const finalText = (transcript + " " + interim).trim();
    setInterim("");
    if (!finalText) {
      toast.error("Didn't catch anything. Try again.");
      setPhase("idle");
      return;
    }
    await captureNow(finalText);
  };

  const liveText = (transcript + " " + interim).trim();

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {phase === "listening" && "Listening…"}
              {phase === "saving" && "Saving to Inbox…"}
              {phase === "idle" && "Talk"}
            </DialogTitle>
            <DialogDescription>
              {phase === "listening" && "Speak naturally. We'll drop it in your Inbox and AI will suggest how to file it."}
              {phase === "saving" && "Just a sec…"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={liveText}
              onChange={(e) => { setTranscript(e.target.value); setInterim(""); }}
              rows={5}
              placeholder="Or type your capture here…"
              className="text-sm"
            />
            <div className="flex gap-2">
              {phase === "listening" ? (
                <Button onClick={stopListening} className="flex-1 gap-2">
                  <Square className="h-4 w-4" /> Stop & capture
                </Button>
              ) : phase === "saving" ? (
                <Button disabled className="flex-1 gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </Button>
              ) : (
                <>
                  <Button onClick={startListening} variant="outline" className="gap-2">
                    <Mic className="h-4 w-4" /> Record
                  </Button>
                  <Button
                    onClick={() => liveText.trim() && captureNow(liveText.trim())}
                    disabled={!liveText.trim()}
                    className="flex-1"
                  >
                    Send to Inbox
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
