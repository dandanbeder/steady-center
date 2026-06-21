import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Bot,
  History,
  Info,
  Loader2,
  Mic,
  Sparkles,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CreditBalanceCard } from "@/components/credit-balance-card";
import { getMyAiUsage } from "@/lib/ai-usage.functions";
import { ACTION_WEIGHTS, CREDIT_ANCHOR_MICROS } from "@/lib/credits";

export const Route = createFileRoute("/_authenticated/ai")({
  component: AiPage,
  head: () => ({
    meta: [
      { title: "AI usage, Heartbeat" },
      {
        name: "description",
        content:
          "See your AI credit balance, recent actions, and the cost of each AI feature.",
      },
    ],
  }),
});

const ACTION_LABEL: Record<string, string> = {
  assistant: "Assistant chat",
  coach: "Coach prompts",
  transcribe: "Audio transcription",
  journal_reflect: "Journal reflection",
  notes_ai: "Note helpers",
  notes_journal: "Notes → journal",
  outcomes_ai: "Outcomes AI",
  task_views_ai: "Task views AI",
  inbox_ai: "Inbox triage",
  daily_pulse: "Daily pulse",
  weekly_plan: "Weekly plan",
  weekly_report: "Weekly report",
  team_progress: "Team progress",
  other: "Other",
};

function actionLabel(t: string): string {
  return ACTION_LABEL[t] ?? t;
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AiPage() {
  const loadUsage = useServerFn(getMyAiUsage);
  const usageQ = useQuery({
    queryKey: ["my-ai-usage"],
    queryFn: () => loadUsage({ data: { limit: 50 } }),
    staleTime: 30_000,
  });

  return (
    <TooltipProvider>
      <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link to="/billing" className="inline-flex items-center gap-1 hover:underline">
                <ArrowLeft className="h-3 w-3" /> Billing
              </Link>
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Bot className="h-6 w-6" /> AI usage
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your allowance, purchased credits, and what each action costs — so there
              are no surprises.
            </p>
          </div>
          {usageQ.data?.pooled && (
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" /> Team pool
            </Badge>
          )}
        </div>

        {/* Balance + low-balance/hard-stop UI (also opens the top-up dialog) */}
        <CreditBalanceCard />

        {/* Predictable pricing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> What each action costs
            </CardTitle>
            <CardDescription>
              You're only ever charged for the model time you actually use — these are
              the typical credit costs when we don't have an exact measurement.
              {" "}1 credit ≈ ${(CREDIT_ANCHOR_MICROS / 1_000_000).toFixed(4)} of model cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(ACTION_WEIGHTS)
                .sort((a, b) => b[1] - a[1])
                .map(([key, credits]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {key === "transcribe" ? (
                        <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {actionLabel(key)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      ~{credits} {credits === 1 ? "credit" : "credits"}
                      {key === "transcribe" ? " / min" : ""}
                    </span>
                  </div>
                ))}
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3" />
              Heavier prompts cost more; lighter ones cost less. The history below shows
              what each call actually charged.
            </p>
          </CardContent>
        </Card>

        {/* Usage history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" /> Recent AI actions
                </CardTitle>
                <CardDescription>
                  Metadata only — we never store the prompt or the content of your
                  notes, messages, or transcripts here.
                </CardDescription>
              </div>
              {usageQ.data && (
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums">
                    {usageQ.data.totals30d.credits}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    credits in last 30 days
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {usageQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : usageQ.data && usageQ.data.items.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageQ.data.items.map((row) => {
                      const tokens =
                        row.audio_seconds > 0
                          ? `${Math.round(row.audio_seconds / 60)} min audio`
                          : `${(row.tokens_in + row.tokens_out).toLocaleString()}`;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {fmtDateTime(row.created_at)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {actionLabel(row.action_type)}
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground">
                                  {row.model_used.split("/").pop()}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{row.model_used}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {tokens}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {row.credits_charged}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {usageQ.data.hasMore && (
                  <>
                    <Separator className="my-3" />
                    <p className="text-center text-xs text-muted-foreground">
                      Showing the latest 50 actions. Older history is kept for
                      auditing.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No AI actions yet. Try the Assistant, transcribe a meeting, or run a
                weekly plan to see your usage here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
