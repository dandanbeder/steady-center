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
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string>("");
  const [matches, setMatches] = useState<Match[]>([]);

  const run = async () => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setAnswer("");
    setMatches([]);
    try {
      const res = await ask({
        data: {
          question: q.trim(),
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
          <Button onClick={run} disabled={loading || q.trim().length < 2} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </Button>
        </div>
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
