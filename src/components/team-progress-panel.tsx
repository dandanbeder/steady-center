import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Users, Send, Loader2, Target, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { teamProgress, askTeam } from "@/lib/team-progress.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

type Source = {
  n: number;
  type: "task" | "outcome";
  id: string;
  title: string;
  snippet: string;
  link: string;
};

export function TeamProgressPanel({ businessId }: { businessId: string | null }) {
  const tp = useServerFn(teamProgress);
  const ask = useServerFn(askTeam);
  const { data, isLoading } = useQuery({
    queryKey: ["team-progress", businessId],
    queryFn: () => tp({ data: { businessId } }),
    staleTime: 60_000,
  });

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [matches, setMatches] = useState<Source[]>([]);

  const run = async () => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setAnswer("");
    setMatches([]);
    try {
      const res = await ask({ data: { question: q.trim(), businessId } });
      setAnswer(res.answer);
      setMatches(res.matches as Source[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading team progress…
      </div>
    );
  }

  const hasTeam = (data?.members.length ?? 0) > 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-serif">Team progress</h2>
      </div>
      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Only shared work, tasks assigned in accounts you share with each teammate.
          Private tasks, notes, and journals are never shown here.
        </span>
      </p>

      {!hasTeam ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
          No teammates in shared accounts yet. Invite someone to an account to see their shared progress.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data!.members.map((m) => {
              const pct =
                m.counts.total > 0 ? Math.round((m.counts.done / m.counts.total) * 100) : 0;
              return (
                <div key={m.user_id} className="rounded-lg border border-border p-4 bg-card space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm">{m.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.counts.done} of {m.counts.total} complete
                    </div>
                  </div>
                  <Progress value={pct} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{m.counts.in_progress} in progress</span>
                    <span>{m.counts.todo} to do</span>
                    {m.counts.blocked > 0 && <span>{m.counts.blocked} blocked</span>}
                    {m.counts.overdue > 0 && (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {m.counts.overdue} overdue
                      </span>
                    )}
                  </div>

                  {m.in_progress.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        In progress
                      </div>
                      <ul className="text-sm space-y-0.5">
                        {m.in_progress.map((t) => (
                          <li key={t.id}>
                            <a
                              href={`/tasks?focus=${t.id}`}
                              className="hover:underline text-foreground/90"
                            >
                              {t.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {m.overdue.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Could use support, overdue
                      </div>
                      <ul className="text-sm space-y-0.5">
                        {m.overdue.map((t) => (
                          <li key={t.id}>
                            <a
                              href={`/tasks?focus=${t.id}`}
                              className="hover:underline text-foreground/90"
                            >
                              {t.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {m.outcomes.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Contributing to
                      </div>
                      <ul className="text-sm space-y-0.5">
                        {m.outcomes.map((o) => (
                          <li key={o.id} className="flex items-center gap-1.5">
                            <Target className="h-3 w-3 text-muted-foreground" />
                            <a
                              href={`/outcomes?focus=${o.id}`}
                              className="hover:underline text-foreground/90"
                            >
                              {o.name}
                            </a>
                            <span className="text-xs text-muted-foreground">
                              ({o.task_count} task{o.task_count === 1 ? "" : "s"})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ask about the team
            </h3>
            <Textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. How is David tracking on the launch outcome?"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
              }}
            />
            <div className="flex justify-end">
              <Button onClick={run} disabled={loading || q.trim().length < 2} className="gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Ask
              </Button>
            </div>

            {answer && (
              <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border p-4 bg-card">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
              </div>
            )}
            {matches.length > 0 && (
              <ol className="space-y-2">
                {matches.map((m) => (
                  <li key={`${m.type}-${m.id}`} className="rounded-md border border-border p-3 bg-card">
                    <a href={m.link} className="text-sm font-medium hover:underline flex items-start gap-2">
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 mt-0.5">
                        {m.type === "task" ? "Task" : "Outcome"}
                      </span>
                      <span>
                        [{m.n}] {m.title}
                      </span>
                    </a>
                    {m.snippet && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.snippet}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}
