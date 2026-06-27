import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  analyticsOverview, analyticsByPlan, analyticsRevenue, analyticsFunnel,
  analyticsEngagement, analyticsAi, analyticsChurnRisk, analyticsSegmentUsers,
  analyticsRefreshNow, analyticsUsers, analyticsStorage,
  analyticsFullReportUsers, analyticsFullReportSubscriptions,
  type AnalyticsSegment,
} from "@/lib/analytics-admin.functions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics · Super Admin" }] }),
  component: AnalyticsPage,
});

function fmtCents(c: number | undefined | null) {
  const v = Number(c ?? 0) / 100;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function pct(x: number | undefined | null) {
  return ((x ?? 0) * 100).toFixed(1) + "%";
}
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function AnalyticsPage() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultFrom = useMemo(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
    [],
  );
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);

  const range = useMemo(() => {
    // Inclusive end-of-day for "to"
    const fromISO = new Date(`${fromDate}T00:00:00Z`).toISOString();
    const toISO = new Date(`${toDate}T23:59:59Z`).toISOString();
    return { from: fromISO, to: toISO };
  }, [fromDate, toDate]);

  const refresh = useServerFn(analyticsRefreshNow);
  const fullUsers = useServerFn(analyticsFullReportUsers);
  const fullSubs = useServerFn(analyticsFullReportSubscriptions);

  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Super-admin only, gated server-side. Reads from daily rollups.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="w-[150px]" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" value={toDate} min={fromDate} max={today} onChange={(e) => setToDate(e.target.value)} className="w-[150px]" />
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              const r = await fullUsers();
              downloadCsv(`users-full-report-${today}.csv`, r.rows as any);
            }}
          >
            <Download className="h-4 w-4 mr-1" /> Users CSV
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              const r = await fullSubs();
              downloadCsv(`subscriptions-full-report-${today}.csv`, r.rows as any);
            }}
          >
            <Download className="h-4 w-4 mr-1" /> Subs CSV
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              await refresh();
              toast.success("Rollups refreshed");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full overflow-x-auto whitespace-nowrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="plans">Subscriptions</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="engagement">Platform usage</TabsTrigger>
          <TabsTrigger value="ai">AI economics</TabsTrigger>
          <TabsTrigger value="churn">Churn & risk</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6"><OverviewPanel range={range} /></TabsContent>
        <TabsContent value="users" className="mt-6"><UsersPanel range={range} /></TabsContent>
        <TabsContent value="plans" className="mt-6"><PlansPanel /></TabsContent>
        <TabsContent value="revenue" className="mt-6"><RevenuePanel range={range} /></TabsContent>
        <TabsContent value="funnel" className="mt-6"><FunnelPanel range={range} /></TabsContent>
        <TabsContent value="engagement" className="mt-6"><EngagementPanel range={range} /></TabsContent>
        <TabsContent value="ai" className="mt-6"><AiPanel range={range} /></TabsContent>
        <TabsContent value="churn" className="mt-6"><ChurnPanel range={range} /></TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2"><CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wider truncate">{label}</CardTitle></CardHeader>
      <CardContent className="min-w-0">
        <div className="text-lg sm:text-xl lg:text-2xl font-semibold tabular-nums break-words leading-tight">{value}</div>
        {sub != null && <div className="text-xs text-muted-foreground mt-1 break-words">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ============ OVERVIEW ============
function OverviewPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsOverview);
  const q = useQuery({ queryKey: ["analytics", "overview", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Total users" value={d?.totalUsers ?? "-"} sub={`+${d?.signupsToday ?? 0} today · +${d?.signups7d ?? 0} / 7d · +${d?.signups30d ?? 0} / 30d`} />
        <StatCard label="DAU / WAU / MAU" value={`${d?.dau ?? 0} / ${d?.wau ?? 0} / ${d?.mau ?? 0}`} sub={`stickiness ${pct(d?.stickiness)}`} />
        <StatCard label="Total accounts" value={d?.totalAccounts ?? "-"} />
        <StatCard label="Paying customers" value={d?.payingCustomers ?? "-"} />
        <StatCard label="MRR" value={fmtCents(d?.mrrCents)} sub={`ARR ${fmtCents(d?.arrCents)}`} />
        <StatCard label="ARPU" value={fmtCents(d?.arpuCents)} />
        <StatCard label="Trial conversion (30d)" value={pct(d?.trialConversionRate)} />
        <StatCard label="Churn (30d)" value={pct(d?.churnRate30d)} />
      </div>
      <Card>
        <CardHeader><CardTitle>DAU & signups · last 30 days</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d?.sparkline ?? []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="signups" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{d?.paddleNote}</p>
    </div>
  );
}

// ============ BY PLAN ============
function PlansPanel() {
  const fn = useServerFn(analyticsByPlan);
  const q = useQuery({ queryKey: ["analytics", "byPlan"], queryFn: () => fn() });
  const [segment, setSegment] = useState<AnalyticsSegment | null>(null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Trialing" value={q.data?.totals?.trialing ?? 0} sub={<button className="underline" onClick={() => setSegment("trialing")}>view users</button>} />
        <StatCard label="Past due" value={q.data?.totals?.past_due ?? 0} sub={<button className="underline" onClick={() => setSegment("past_due")}>view users</button>} />
        <StatCard label="Canceled" value={q.data?.totals?.canceled ?? 0} sub={<button className="underline" onClick={() => setSegment("canceled")}>view users</button>} />
        <StatCard label="Team seats sold" value={q.data?.totals?.team_seats_sold ?? 0} />
      </div>
      <Card>
        <CardHeader><CardTitle>Plan distribution</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Plan</TableHead><TableHead>Users</TableHead><TableHead>%</TableHead><TableHead>MRR</TableHead><TableHead>Seats</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.plan}>
                  <TableCell className="capitalize">{r.plan}</TableCell>
                  <TableCell>{r.users}</TableCell>
                  <TableCell>{pct(r.pct)}</TableCell>
                  <TableCell>{fmtCents(r.mrrCents)}</TableCell>
                  <TableCell>{("seats" in r ? r.seats : "-") as any}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setSegment(r.plan as AnalyticsSegment)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={q.data?.rows ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="plan" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="users" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <SegmentDialog segment={segment} onClose={() => setSegment(null)} />
    </div>
  );
}

// ============ REVENUE ============
function RevenuePanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsRevenue);
  const q = useQuery({ queryKey: ["analytics", "revenue", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="MRR" value={fmtCents(d?.series.at(-1)?.mrrCents)} />
        <StatCard label="ARPU" value={fmtCents(d?.arpuCents)} />
        <StatCard label="Monthly / Annual subs" value={`${d?.monthlyVsAnnual.monthly ?? 0} / ${d?.monthlyVsAnnual.annual ?? 0}`} />
        <StatCard label="LTV (est)" value={fmtCents(d?.ltvEstimateCents)} sub="ARPU × 24 mo" />
      </div>
      <Card>
        <CardHeader><CardTitle>MRR over time</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={(d?.series ?? []).map((s) => ({ ...s, mrr: s.mrrCents / 100, pro: s.proMrrCents / 100, team: s.teamMrrCents / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend />
              <Line type="monotone" dataKey="mrr" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pro" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="team" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Net MRR change (new – churned)</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(d?.series ?? []).map((s) => ({ day: s.day, delta: s.netNewCents / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="delta" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{d?.reconciliationNote}</p>
    </div>
  );
}

// ============ FUNNEL ============
function FunnelPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsFunnel);
  const q = useQuery({ queryKey: ["analytics", "funnel", range], queryFn: () => fn({ data: range }) });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Growth funnel</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Stage</TableHead><TableHead>Count</TableHead><TableHead>Conversion from signup</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.stages ?? []).map((s) => (
                <TableRow key={s.stage}>
                  <TableCell>{s.stage}</TableCell>
                  <TableCell>{s.count}</TableCell>
                  <TableCell>{pct(s.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={q.data?.stages ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="stage" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{q.data?.timeToConvertNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============ ENGAGEMENT ============
function EngagementPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsEngagement);
  const q = useQuery({ queryKey: ["analytics", "engagement", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Active user trend</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d?.activeTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" dot={false} />
              <Line type="monotone" dataKey="wau" stroke="hsl(var(--accent))" dot={false} />
              <Line type="monotone" dataKey="mau" stroke="hsl(var(--muted-foreground))" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Feature adoption</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Users</TableHead><TableHead>% of total</TableHead></TableRow></TableHeader>
            <TableBody>
              {(["calendar_sync", "meetings", "ai", "sharing"] as const).map((f) => (
                <TableRow key={f}>
                  <TableCell className="capitalize">{f.replace("_", " ")}</TableCell>
                  <TableCell>{d?.adoptionCounts?.[f] ?? 0}</TableCell>
                  <TableCell>{pct(d?.adoption?.[f] ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">Stickiness DAU/MAU: <strong>{pct(d?.stickiness)}</strong></p>
          <p className="text-xs text-muted-foreground mt-1">{d?.retentionNote}</p>
        </CardContent>
      </Card>
      <StorageCard />
    </div>
  );
}

// ============ AI ============
function AiPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsAi);
  const q = useQuery({ queryKey: ["analytics", "ai", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="AI actions (range)" value={d?.totalActions ?? 0} />
        <StatCard label="AI tokens" value={d?.totalTokens ?? 0} />
        <StatCard label="AI cost" value={fmtCents(d?.totalCostCents)} />
        <StatCard label="Margin" value={fmtCents(d?.marginCents)} sub={`revenue ${fmtCents(d?.revenueCents)}`} />
      </div>
      <Card>
        <CardHeader><CardTitle>Actions by plan</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={Object.entries(d?.actionsByPlan ?? {}).map(([plan, actions]) => ({ plan, actions }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="plan" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="actions" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{d?.note}</p>
    </div>
  );
}

// ============ CHURN ============
function ChurnPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsChurnRisk);
  const q = useQuery({ queryKey: ["analytics", "churn", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  const [segment, setSegment] = useState<AnalyticsSegment | null>(null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Churn rate (range)" value={pct(d?.churnRate)} />
        <StatCard label="Trial ending ≤ 3d" value={d?.atRisk?.trial_ending_3d ?? 0} sub={<button className="underline" onClick={() => setSegment("trial_ending")}>view</button>} />
        <StatCard label="Payment failed" value={d?.atRisk?.payment_failed ?? 0} sub={<button className="underline" onClick={() => setSegment("past_due")}>view</button>} />
        <StatCard label="Inactive 14d+" value={d?.atRisk?.inactive_14d ?? 0} sub={<button className="underline" onClick={() => setSegment("inactive_14d")}>view</button>} />
      </div>
      <Card>
        <CardHeader><CardTitle>Cancellations trend</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d?.cancellationsTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <SegmentDialog segment={segment} onClose={() => setSegment(null)} />
    </div>
  );
}

// ============ SEGMENT DIALOG (click-through + CSV) ============
function SegmentDialog({ segment, onClose }: { segment: AnalyticsSegment | null; onClose: () => void }) {
  const fn = useServerFn(analyticsSegmentUsers);
  const q = useQuery({
    queryKey: ["analytics", "segment", segment],
    queryFn: () => fn({ data: { segment: segment as AnalyticsSegment } }),
    enabled: !!segment,
  });
  return (
    <Dialog open={!!segment} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="capitalize flex items-center gap-2">
            {segment?.replace("_", " ")}
            <Badge variant="secondary">{q.data?.users?.length ?? 0}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button
            size="sm" variant="outline"
            onClick={() => downloadCsv(`segment-${segment}.csv`, q.data?.users ?? [])}
          >
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Organisation</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {(q.data?.users ?? []).map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link to="/admin/users/$userId" params={{ userId: u.id }} className="underline hover:text-primary">
                      {u.full_name || "(no name)"}
                    </Link>
                  </TableCell>
                  <TableCell>{u.organisation || "-"}</TableCell>
                  <TableCell>{u.status || "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.created_at?.slice(0, 10) ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ USERS ============
function UsersPanel({ range }: { range: { from: string; to: string } }) {
  const fn = useServerFn(analyticsUsers);
  const q = useQuery({ queryKey: ["analytics", "users", range], queryFn: () => fn({ data: range }) });
  const d = q.data;
  const [segment, setSegment] = useState<AnalyticsSegment | null>(null);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total users"
          value={d?.total ?? "-"}
          sub={<button className="underline" onClick={() => setSegment("all")}>view all</button>}
        />
        <StatCard
          label="Active"
          value={d?.statusBreakdown.active ?? 0}
          sub={<button className="underline" onClick={() => setSegment("active")}>view</button>}
        />
        <StatCard
          label="Suspended"
          value={d?.statusBreakdown.suspended ?? 0}
          sub={<button className="underline" onClick={() => setSegment("suspended")}>view</button>}
        />
        <StatCard
          label="Scheduled deletion"
          value={d?.scheduledDeletion ?? 0}
          sub={<button className="underline" onClick={() => setSegment("scheduled_deletion")}>view</button>}
        />
        <StatCard
          label="Super admins"
          value={d?.roleBreakdown.superadmin ?? 0}
          sub={<button className="underline" onClick={() => setSegment("superadmin")}>view</button>}
        />
        <StatCard label="Regular users" value={d?.roleBreakdown.user ?? 0} />
      </div>

      <Card>
        <CardHeader><CardTitle>Signups by day (cohort)</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d?.growth ?? []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="signups" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cumulative user growth</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d?.cumulative ?? []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Breakdown</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Segment</TableHead><TableHead>Count</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {[
                { label: "Active", key: "active" as const, count: d?.statusBreakdown.active ?? 0 },
                { label: "Suspended", key: "suspended" as const, count: d?.statusBreakdown.suspended ?? 0 },
                { label: "Scheduled deletion", key: "scheduled_deletion" as const, count: d?.scheduledDeletion ?? 0 },
                { label: "Super admins", key: "superadmin" as const, count: d?.roleBreakdown.superadmin ?? 0 },
              ].map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setSegment(row.key)}>View users</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SegmentDialog segment={segment} onClose={() => setSegment(null)} />
    </div>
  );
}

// ============ STORAGE CARD (used inside Engagement panel) ============
function StorageCard() {
  const fn = useServerFn(analyticsStorage);
  const q = useQuery({ queryKey: ["analytics", "storage"], queryFn: () => fn() });
  const d = q.data;
  const fmtBytes = (n: number) => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };
  return (
    <Card>
      <CardHeader><CardTitle>Storage used (attachments)</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard label="Total" value={fmtBytes(d?.totalBytes ?? 0)} />
          <StatCard label="Files" value={d?.fileCount ?? 0} />
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Mime type</TableHead><TableHead>Size</TableHead></TableRow></TableHeader>
          <TableBody>
            {(d?.byMime ?? []).map((r) => (
              <TableRow key={r.mime}>
                <TableCell className="text-xs">{r.mime}</TableCell>
                <TableCell>{fmtBytes(r.bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
