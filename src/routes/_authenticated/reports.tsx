import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listWeeklyReports, reportStatus, type WeeklyReport } from "@/lib/weekly-reports";
import { generateWeeklyReportNow } from "@/lib/weekly-reports.functions";
import { WeeklyGoalsPanel } from "@/components/weekly-goals-panel";
import { UpgradeGate } from "@/components/upgrade-gate";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports · Heartbeat" }] }),
  component: () => (
    <UpgradeGate feature="weekly_reports">
      <ReportsPage />
    </UpgradeGate>
  ),
});

function ReportsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["weekly-reports"],
    queryFn: listWeeklyReports,
  });
  const generate = useServerFn(generateWeeklyReportNow);
  const gen = useMutation({
    mutationFn: () => generate({ data: undefined }),
    onSuccess: async ({ id }) => {
      toast.success("Report generated");
      await qc.invalidateQueries({ queryKey: ["weekly-reports"] });
      router.navigate({ to: "/reports/$reportId", params: { reportId: id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16 space-y-10">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary">Weekly reflections</h1>
          <p className="mt-2 text-muted-foreground">
            A kind look back at the week, plus a gentle nudge as you plan the next one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/reports/team"
            className="text-sm px-3 py-2 rounded-md border border-border hover:bg-accent/40 transition-colors"
          >
            Team report →
          </Link>
          <Button onClick={() => gen.mutate()} disabled={gen.isPending}>
            {gen.isPending ? "Reflecting…" : "Reflect on this week"}
          </Button>
        </div>
      </header>
      <WeeklyGoalsPanel />


      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reports.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No reflections yet. When you're ready, "Reflect on this week" puts together a calm look at the last 7 days.
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => <ReportRow key={r.id} report={r} />)}
        </div>
      )}
    </div>
  );
}

function ReportRow({ report }: { report: WeeklyReport }) {
  const o = report.metrics?.overall;
  const rate = Math.round((o?.completion_rate ?? 0) * 100);
  const status = reportStatus(report);
  return (
    <Link to="/reports/$reportId" params={{ reportId: report.id }} className="block">
      <Card className="p-5 flex items-center gap-5 hover:bg-accent/30 transition-colors">
        <span
          aria-label={status === "green" ? "Steady week" : "A few things to look at gently"}
          className="inline-block size-3 rounded-full shrink-0"
          style={{
            backgroundColor: status === "green" ? "oklch(0.72 0.16 150)" : "oklch(0.78 0.14 85)",
          }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {new Date(report.week_start).toLocaleDateString()} to{" "}
            {new Date(report.week_end).toLocaleDateString()}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {report.narrative?.headline || "A kind look back"}
          </p>
        </div>
        <div className="flex gap-6 text-sm shrink-0">
          <div className="text-right">
            <div className="text-lg font-medium">{rate}%</div>
            <div className="text-xs text-muted-foreground">completion</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-medium">{o?.tasks_completed ?? 0}</div>
            <div className="text-xs text-muted-foreground">done</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
