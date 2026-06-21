import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Send, Loader2, Mic, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { askNotes } from "@/lib/notes-journal.functions";
import { transcribeAudio } from "@/lib/transcribe.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UpgradeGate } from "@/components/upgrade-gate";
import { Separator } from "@/components/ui/separator";
import { TeamProgressPanel } from "@/components/team-progress-panel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ask-notes")({
  component: () => (
    <UpgradeGate feature="ai_assistant">
      <AskNotesPage />
    </UpgradeGate>
  ),
});

type Match = {
  n: number;
  type: "note" | "meeting" | "task" | "outcome";
  id: string;
  title: string;
  snippet: string;
  link: string;
};

const TYPE_LABEL: Record<Match["type"], string> = {
  note: "Note",
  meeting: "Meeting",
  task: "Task",
  outcome: "Outcome",
};

function AskNotesPage() {
  const { activeId } = useActiveBusiness();
  const ask = useServerFn(askNotes);
  const transcribe = useServerFn(transcribeAudio);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string>("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const runQuery = async (question: string) => {
    if (question.trim().length < 2) return;
    setLoading(true);
    setAnswer("");
    setMatches([]);
    try {
      const res = await ask({
        data: {
          question: question.trim(),
          businessId: activeId === ALL ? null : activeId,
        },
      });
      setAnswer(res.answer);
      setMatches(res.matches as Match[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const run = () => runQuery(q);

  const stopMicTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    if (recording || transcribing) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone access is needed to record.");
      return;
    }
    const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      stream.getTracks().forEach((t) => t.stop());
      toast.error("This browser can't record a supported audio format.");
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stopMicTracks();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      if (blob.size < 1024) {
        toast.error("That recording was empty — please try again.");
        return;
      }
      setTranscribing(true);
      try {
        const buf = await blob.arrayBuffer();
        // Encode to base64 in chunks to avoid large-string call stack issues.
        let binary = "";
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const audio_base64 = btoa(binary);
        const { text } = await transcribe({
          data: { audio_base64, mime: recorder.mimeType },
        });
        if (!text) {
          toast.error("Couldn't hear anything in that recording.");
          return;
        }
        setQ((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        toast.success("Transcribed — review and tap Ask.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setTranscribing(false);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  const stopRecording = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      stopMicTracks();
    }
    recorderRef.current = null;
    setRecording(false);
  };

  const examples = [
    "What did we decide about pricing in last week's meetings?",
    "What's overdue this week?",
    "What's linked to the Q3 outcome and how is it tracking?",
  ];

  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-serif flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          Ask Heartbeat
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask anything across your notes, meetings, tasks, and outcomes. I'll answer only from what you can access, with sources.
        </p>
      </header>

      <div className="space-y-3">
        <Textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. What did we decide about the new pricing tiers?"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setQ(ex)}
                className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={recording ? "default" : "outline"}
              size="icon"
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing}
              aria-label={recording ? "Stop recording" : "Record question"}
              title={recording ? "Stop & transcribe" : "Speak your question"}
              className={cn(recording && "animate-pulse")}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : recording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button onClick={run} disabled={loading || q.trim().length < 2} className="gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Ask
            </Button>
          </div>
        </div>
        {(recording || transcribing) && (
          <p className="text-xs text-muted-foreground">
            {recording ? "Listening… tap stop when you're done." : "Transcribing your recording…"}
          </p>
        )}
      </div>

      {answer && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Answer
          </h2>
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border p-4 bg-card">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </div>
        </section>
      )}

      {matches.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </h2>
          <ol className="space-y-2">
            {matches.map((m) => (
              <li key={`${m.type}-${m.id}`} className="rounded-md border border-border p-3 bg-card">
                <a
                  href={m.link}
                  className="text-sm font-medium hover:underline flex items-start gap-2"
                >
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 mt-0.5">
                    {TYPE_LABEL[m.type]}
                  </span>
                  <span>[{m.n}] {m.title}</span>
                </a>
                {m.snippet && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.snippet}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <Separator className="my-2" />
      <TeamProgressPanel businessId={activeId === ALL ? null : activeId} />
    </div>
  );
}
