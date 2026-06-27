import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  adminFinancialsSummary,
  type FinancialsSummary,
} from "@/lib/admin-financials.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/financials")({
  component: FinancialsPage,
});

const fmtMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

const fmtMoney2 = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

const fmtPct = (n: number) =>
  `${((n ?? 0) * 100).toFixed(n > 0.1 || n < -0.1 ? 0 : 1)}%`;

const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n ?? 0);

function FinancialsPage() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const fn = useServerFn(adminFinancialsSummary);
  const q = useQuery({
    queryKey: ["admin-financials"],
    queryFn: () => fn(),
    enabled: !!isAdmin,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Financials &amp; Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Curated revenue, margin, and growth, operational metadata only.
            </p>
          </div>
        </div>
        <Link
          to="/admin"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Admin
        </Link>
      </div>

      {q.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : q.error ? (
        <div className="text-destructive">Error: {String((q.error as Error).message)}</div>
      ) : q.data ? (
        <Dashboard data={q.data} />
      ) : null}

      <div className="pt-2 flex gap-4 flex-wrap text-sm">
        <Link to="/admin/analytics" className="underline text-primary">
          Full analytics →
        </Link>
        <Link to="/admin/ai-economics" className="underline text-primary">
          AI economics →
        </Link>
        <Link to="/admin/billing" className="underline text-primary">
          Billing &amp; plans →
        </Link>
        <Link to="/admin/payments" className="underline text-primary">
          Payments diagnostic →
        </Link>
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: FinancialsSummary }) {
  const h = data.headline;
  const marginGood = h.contributionMarginCents >= 0;
  return (
    <div className="space-y-8">
      {/* Headline, contribution margin is the hero */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Contribution margin (this month, est.)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-4 flex-wrap">
            <div
              className={`text-4xl font-semibold tabular-nums ${
                marginGood ? "text-foreground" : "text-destructive"
              }`}
            >
              {fmtMoney(h.contributionMarginCents)}
            </div>
            <Badge variant={marginGood ? "default" : "destructive"}>
              {fmtPct(h.contributionMarginPct)} margin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Revenue minus real AI cost, ~7% Paddle/FX, and infra. The number
            that says whether each customer is actually profitable.
          </p>
        </CardContent>
      </Card>

      {/* Top KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="MRR" value={fmtMoney(h.mrrCents)} sub={`ARR ${fmtMoney(h.arrCents)}`} />
        <Kpi
          label="Paying customers"
          value={fmtInt(h.payingCustomers)}
          sub={`ARPU ${fmtMoney2(h.arpuCents)}/mo`}
        />
        <Kpi
          label="Top-up revenue (30d)"
          value={fmtMoney(data.topups.revenue30dCents)}
          sub={`${fmtInt(data.topups.purchases30d)} purchases · ${fmtInt(
            data.topups.creditsSold30d,
          )} credits`}
        />
        <Kpi
          label="AI burn (30d)"
          value={fmtMoney(data.cash.aiBurn30dMicros / 10_000)}
          sub={
            data.cash.runwayDays != null
              ? `Kitty runway ~${data.cash.runwayDays}d`
              : `Kitty ${fmtMoney(data.cash.kittyRemainingMicros / 10_000)}`
          }
        />
      </div>

      {/* Revenue by plan */}
      <Section
        title="Revenue & margin by plan"
        subtitle="AI cost prorated by share of MRR. Paddle/FX at 7% of gross."
      >
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">MRR</TableHead>
                <TableHead className="text-right">AI cost</TableHead>
                <TableHead className="text-right">Paddle</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.revenueByPlan.map((r) => (
                <TableRow key={r.plan}>
                  <TableCell className="font-medium capitalize">
                    {r.plan}
                    {r.seats != null && (
                      <span className="text-muted-foreground text-xs ml-2">
                        {fmtInt(r.seats)} seats
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.users)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(r.mrrCents)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    −{fmtMoney(r.aiCostCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    −{fmtMoney(r.paddleCostCents)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      r.marginCents >= 0 ? "" : "text-destructive"
                    }`}
                  >
                    {fmtMoney(r.marginCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(r.marginPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <div className="text-xs text-muted-foreground mt-2">
          Billing mix: {fmtInt(data.billingMix.monthly)} monthly ·{" "}
          {fmtInt(data.billingMix.annual)} annual
        </div>
      </Section>

      {/* MRR movement */}
      <Section title="MRR movement (last 30 days)">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <Movement label="New" cents={data.mrrMovement30d.newCents} good />
          <Movement label="Expansion" cents={data.mrrMovement30d.expansionCents} good />
          <Movement label="Contraction" cents={-data.mrrMovement30d.contractionCents} />
          <Movement label="Churned" cents={-data.mrrMovement30d.churnedCents} />
          <Movement
            label="Net"
            cents={data.mrrMovement30d.netCents}
            good={data.mrrMovement30d.netCents >= 0}
            emphasis
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">{data.mrrMovement30d.note}</p>
      </Section>

      {/* Conversion & churn */}
      <Section title="Conversion & retention">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Trial → paid"
            value={fmtPct(data.conversion.trialConversionRate)}
            sub={`${fmtInt(data.conversion.trialConverted30d)} of ${fmtInt(
              data.conversion.trialStarted30d,
            )} trials (30d)`}
          />
          <Kpi
            label="Logo churn (30d)"
            value={fmtPct(data.conversion.logoChurnRate30d)}
            sub="Cancellations ÷ paying"
          />
          <Kpi
            label="Revenue churn (30d)"
            value={fmtPct(data.conversion.revenueChurnRate30d)}
            sub="MRR lost ÷ MRR"
          />
          <Kpi
            label="LTV estimate"
            value={fmtMoney(data.conversion.ltvEstimateCents)}
            sub="ARPU ÷ monthly churn"
          />
        </div>
      </Section>

      {/* Cash view */}
      <Section title="Cash view">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Collected (30d est.)"
            value={fmtMoney(data.cash.collected30dCents)}
            sub="MRR + top-ups"
          />
          <Kpi
            label="AI cost (30d)"
            value={fmtMoney(data.cash.aiBurn30dMicros / 10_000)}
            sub={`All-time ${fmtMoney(data.cash.aiBurnAllTimeMicros / 10_000)}`}
          />
          <Kpi
            label="Kitty remaining"
            value={fmtMoney(data.cash.kittyRemainingMicros / 10_000)}
            sub={data.cash.runwayDays != null ? `~${data.cash.runwayDays} days runway` : "-"}
          />
          <Kpi
            label="Top-ups all-time"
            value={fmtMoney(data.topups.revenueAllTimeCents)}
            sub={`${fmtInt(data.topups.purchasesAllTime)} purchases`}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">{data.cash.payoutLagNote}</p>
      </Section>

      {/* Users & engagement */}
      <Section title="Users & engagement">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Total users"
            value={fmtInt(data.users.total)}
            sub={`+${fmtInt(data.users.new7d)} this week · +${fmtInt(
              data.users.new30d,
            )} this month`}
          />
          <Kpi label="DAU / WAU / MAU" value={`${data.users.dau} · ${data.users.wau} · ${data.users.mau}`} sub={`Stickiness ${fmtPct(data.users.stickiness)}`} />
          <Kpi
            label="Free / Pro / Team"
            value={`${fmtInt(data.users.planDistribution.free)} · ${fmtInt(
              data.users.planDistribution.pro,
            )} · ${fmtInt(data.users.planDistribution.team)}`}
            sub="Plan distribution"
          />
          <Kpi
            label="ARPU"
            value={fmtMoney2(data.headline.arpuCents)}
            sub="Per paying customer / month"
          />
        </div>
      </Section>

      {/* Funnel */}
      <Section title="Funnel (last 30 days)">
        <Card>
          <CardContent className="p-6 space-y-3">
            {data.funnel30d.map((s) => (
              <div key={s.stage}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{s.stage}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtInt(s.count)} · {fmtPct(s.rate)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.max(2, Math.min(100, s.rate * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      {/* Trends */}
      <Section title="Trends (last 90 days)">
        <div className="grid gap-4 lg:grid-cols-2">
          <Sparkline
            title="MRR"
            data={data.trends.mrrSeries.map((p) => ({ day: p.day, value: p.mrrCents }))}
            formatter={(v) => fmtMoney(v)}
          />
          <Sparkline
            title="Signups"
            data={data.trends.signupsSeries.map((p) => ({ day: p.day, value: p.signups }))}
            formatter={fmtInt}
          />
          <Sparkline
            title="AI actions"
            data={data.trends.aiActionsSeries.map((p) => ({ day: p.day, value: p.actions }))}
            formatter={fmtInt}
          />
          <Sparkline
            title="DAU"
            data={data.trends.activeSeries.map((p) => ({ day: p.day, value: p.dau }))}
            formatter={fmtInt}
          />
        </div>
      </Section>

      <p className="text-xs text-muted-foreground">
        Updated {new Date(data.asOf).toLocaleString()}. Paddle is the source of
        truth for invoiced revenue and tax.
      </p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Movement({
  label,
  cents,
  good,
  emphasis,
}: {
  label: string;
  cents: number;
  good?: boolean;
  emphasis?: boolean;
}) {
  const positive = cents >= 0;
  const color = good
    ? positive
      ? "text-emerald-600"
      : "text-destructive"
    : positive
      ? "text-muted-foreground"
      : "text-destructive";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 tabular-nums flex items-center gap-1 ${emphasis ? "text-2xl font-semibold" : "text-xl"} ${color}`}>
          {positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {fmtMoney(Math.abs(cents))}
        </div>
      </CardContent>
    </Card>
  );
}

function Sparkline({
  title,
  data,
  formatter,
}: {
  title: string;
  data: Array<{ day: string; value: number }>;
  formatter: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const latest = data.at(-1)?.value ?? 0;
  const first = data.at(0)?.value ?? 0;
  const delta = latest - first;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-sm tabular-nums">
            {formatter(latest)}{" "}
            <span
              className={`text-xs ${delta >= 0 ? "text-emerald-600" : "text-destructive"}`}
            >
              {delta >= 0 ? "+" : ""}
              {formatter(delta)}
            </span>
          </div>
        </div>
        <svg viewBox={`0 0 ${Math.max(data.length, 1)} 40`} className="w-full h-12" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-primary"
            points={data
              .map((d, i) => `${i},${40 - (d.value / max) * 38}`)
              .join(" ")}
          />
        </svg>
      </CardContent>
    </Card>
  );
}
