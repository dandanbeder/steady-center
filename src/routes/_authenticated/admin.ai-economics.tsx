import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ShieldAlert, AlertTriangle, TrendingUp, TrendingDown, Wallet, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  adminAiEconomicsSummary,
  adminAiPerAccountEconomics,
  adminListKittyEntries,
  adminRecordKittyEntry,
  type PerAccountRow,
} from "@/lib/admin-ai-economics.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/ai-economics")({
  component: AdminAiEconomics,
});

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const usdFromMicros = (micros: number) => usd(micros / 10_000);
const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

function AdminAiEconomics() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const sumFn = useServerFn(adminAiEconomicsSummary);
  const accFn = useServerFn(adminAiPerAccountEconomics);
  const kittyFn = useServerFn(adminListKittyEntries);

  const summary = useQuery({
    queryKey: ["admin", "ai-econ", "summary"],
    queryFn: () => sumFn(),
    enabled: !!isAdmin,
    staleTime: 30_000,
  });
  const perAccount = useQuery({
    queryKey: ["admin", "ai-econ", "per-account"],
    queryFn: () => accFn(),
    enabled: !!isAdmin,
    staleTime: 30_000,
  });
  const kittyLog = useQuery({
    queryKey: ["admin", "ai-econ", "kitty-log"],
    queryFn: () => kittyFn(),
    enabled: !!isAdmin,
    staleTime: 30_000,
  });

  const [kittyOpen, setKittyOpen] = useState(false);

  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  const s = summary.data;
  const costMicros30d = s?.totals_30d.cost_micros ?? 0;
  const revenueMicros30d =
    (s?.revenue.allowance_value_micros_per_month ?? 0) + (s?.revenue.topup_revenue_30d_cents ?? 0) * 10_000;
  const margin30d = revenueMicros30d - costMicros30d;
  const marginPct = revenueMicros30d > 0 ? (margin30d / revenueMicros30d) * 100 : null;
  const marginErosion = marginPct !== null && marginPct < 20;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">AI Economics</h1>
          <p className="text-sm text-muted-foreground">
            Operational metadata only — no user content. Reads computed from rollups.
          </p>
        </div>
        <Link to="/admin" className="text-sm underline text-primary ml-auto">← Back to admin</Link>
      </div>

      {/* Platform alerts */}
      <div className="space-y-2">
        {marginErosion && (
          <Alert tone="warn"
            title="Margin erosion watch"
            body={`30-day AI revenue ${usdFromMicros(revenueMicros30d)} vs cost ${usdFromMicros(costMicros30d)} — margin only ${marginPct?.toFixed(1)}%.`}
          />
        )}
        {margin30d < 0 && (
          <Alert tone="danger"
            title="AI cost is running AHEAD of revenue (30d)"
            body={`Net loss ${usdFromMicros(-margin30d)} over the last 30 days. Raise pricing, throttle heavy users, or top up the kitty.`}
          />
        )}
        {s?.kitty.low_kitty_alert && (
          <Alert tone="danger"
            title="LOW KITTY — top up before users lose AI"
            body={`Remaining ${usdFromMicros(s.kitty.remaining_micros)} · runway ${s.kitty.runway_days?.toFixed(1) ?? "—"} days at current burn.`}
          />
        )}
      </div>

      {/* Kitty header */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">The Kitty (funded AI budget)</h2>
          </div>
          <Button size="sm" onClick={() => setKittyOpen(true)}><Plus className="h-4 w-4 mr-1" /> Record entry</Button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Funded" value={s ? usdFromMicros(s.kitty.funded_micros) : "—"} />
          <Stat label="Consumed" value={s ? usdFromMicros(s.kitty.consumed_micros) : "—"} />
          <Stat label="Remaining" value={s ? usdFromMicros(s.kitty.remaining_micros) : "—"}
            tone={s?.kitty.low_kitty_alert ? "danger" : undefined} />
          <Stat label="Burn / day (30d)" value={s ? usdFromMicros(s.kitty.daily_burn_micros) : "—"} />
          <Stat label="Runway"
            value={s?.kitty.runway_days == null
              ? "—"
              : `${s.kitty.runway_days.toFixed(s.kitty.runway_days < 10 ? 1 : 0)} d`}
            tone={s?.kitty.runway_days != null && s.kitty.runway_days < 30 ? "warn" : undefined} />
        </div>
        <KittyLog rows={kittyLog.data ?? []} />
      </div>

      {/* Platform economics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="30d AI cost" value={usdFromMicros(costMicros30d)} icon={<TrendingDown className="h-4 w-4 text-destructive" />} />
        <Stat label="30d AI revenue" value={usdFromMicros(revenueMicros30d)} icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} />
        <Stat label="30d margin"
          value={usdFromMicros(margin30d)}
          tone={margin30d < 0 ? "danger" : marginErosion ? "warn" : undefined}
          sub={marginPct !== null ? `${marginPct.toFixed(1)}% margin` : undefined} />
        <Stat label="30d top-up sales"
          value={s ? `${num(s.revenue.topup_purchases_30d)} · ${usd(s.revenue.topup_revenue_30d_cents)}` : "—"} />
      </div>

      {/* Daily trend */}
      <DailyTrend series={s?.series_30d ?? []} />

      {/* Per-account */}
      <PerAccountTable rows={perAccount.data ?? []} loading={perAccount.isLoading} />

      <KittyDialog open={kittyOpen} onClose={() => setKittyOpen(false)} />
    </div>
  );
}

function Stat({
  label, value, sub, tone, icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "danger";
  icon?: React.ReactNode;
}) {
  const cls = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="border rounded-lg p-3 bg-background">
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Alert({ tone, title, body }: { tone: "warn" | "danger"; title: string; body: string }) {
  const cls = tone === "danger"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <div className={`border rounded-lg p-3 flex items-start gap-3 ${cls}`}>
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm opacity-90">{body}</div>
      </div>
    </div>
  );
}

function DailyTrend({ series }: { series: Array<{ day: string; cost_micros: number; events_count: number }> }) {
  if (series.length === 0) {
    return <div className="border rounded-lg p-6 text-sm text-muted-foreground">No usage in the last 30 days.</div>;
  }
  const max = Math.max(...series.map((d) => d.cost_micros), 1);
  return (
    <div className="border rounded-lg p-4">
      <div className="text-sm font-medium mb-3">Real AI cost — last 30 days</div>
      <div className="flex items-end gap-1 h-32">
        {series.map((d) => {
          const h = Math.max(2, (d.cost_micros / max) * 100);
          return (
            <div
              key={d.day}
              className="flex-1 bg-primary/60 rounded-t hover:bg-primary transition-colors"
              style={{ height: `${h}%` }}
              title={`${d.day}: ${usdFromMicros(d.cost_micros)} · ${d.events_count} events`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{series[0]?.day}</span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function PerAccountTable({ rows, loading }: { rows: PerAccountRow[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const [flag, setFlag] = useState<"all" | "over_80" | "hard_stop" | "topup_buyers">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (flag === "over_80" && !r.over_80) return false;
      if (flag === "hard_stop" && !r.hard_stopped) return false;
      if (flag === "topup_buyers" && r.topup_revenue_cents === 0) return false;
      if (needle && !(r.email.toLowerCase().includes(needle) || r.full_name.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, q, flag]);

  const totals = useMemo(() => ({
    over80: rows.filter((r) => r.over_80).length,
    hardStop: rows.filter((r) => r.hard_stopped).length,
  }), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <h2 className="text-lg font-semibold mr-auto">Per-account economics</h2>
        <div>
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or name" className="pl-8 w-56" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Filter</Label>
          <Select value={flag} onValueChange={(v) => setFlag(v as typeof flag)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="over_80">&gt;80% allowance used ({totals.over80})</SelectItem>
              <SelectItem value="hard_stop">Hard-stopped ({totals.hardStop})</SelectItem>
              <SelectItem value="topup_buyers">Top-up buyers</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Allowance used</TableHead>
              <TableHead>Purchased</TableHead>
              <TableHead>Total consumed</TableHead>
              <TableHead>Top-up revenue</TableHead>
              <TableHead>Last event</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground py-6">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground py-6">No accounts match.</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.account_user_id}>
                <TableCell>
                  <div className="font-medium">{r.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    {num(r.allowance_used)} / {num(r.allowance_credits)}
                  </div>
                  <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full ${r.over_80 ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, r.allowance_pct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground">{r.allowance_pct}%</div>
                </TableCell>
                <TableCell className="text-sm">{num(r.purchased_credits)}</TableCell>
                <TableCell className="text-sm">
                  <div>{usdFromMicros(r.total_cost_micros)}</div>
                  <div className="text-xs text-muted-foreground">{num(r.events_count)} events</div>
                </TableCell>
                <TableCell className="text-sm">{usd(r.topup_revenue_cents)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.last_event_at ? new Date(r.last_event_at).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="space-x-1">
                  {r.hard_stopped && <Badge variant="destructive">hard-stop</Badge>}
                  {r.over_80 && !r.hard_stopped && <Badge variant="secondary" className="bg-amber-500/20 text-amber-700">&gt;80%</Badge>}
                  {r.topup_revenue_cents > 0 && <Badge variant="outline">paying</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KittyLog({ rows }: { rows: Array<{ id: string; delta_micros: number; kind: string; note: string | null; created_at: string }> }) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No kitty entries yet. Record what you've funded so remaining and runway stay accurate.
      </div>
    );
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Recent kitty entries ({rows.length})</summary>
      <div className="mt-2 space-y-1">
        {rows.slice(0, 10).map((e) => (
          <div key={e.id} className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground w-32">{new Date(e.created_at).toLocaleString()}</span>
            <Badge variant={e.kind === "fund" ? "default" : "outline"} className="capitalize">{e.kind}</Badge>
            <span className={e.delta_micros >= 0 ? "text-emerald-600" : "text-destructive"}>
              {e.delta_micros >= 0 ? "+" : ""}{usdFromMicros(e.delta_micros)}
            </span>
            {e.note && <span className="text-muted-foreground truncate">{e.note}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}

function KittyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const recordFn = useServerFn(adminRecordKittyEntry);
  const [kind, setKind] = useState<"fund" | "adjust">("fund");
  const [amount, setAmount] = useState<string>("0");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: () => {
      const dollars = parseFloat(amount);
      if (!isFinite(dollars) || dollars === 0) throw new Error("Enter a non-zero dollar amount");
      const cents = Math.round(dollars * 100);
      return recordFn({ data: { delta_cents: cents, kind, note: note || undefined } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "ai-econ"] });
      toast.success("Kitty entry recorded");
      setAmount("0");
      setNote("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record kitty entry</DialogTitle>
          <DialogDescription>
            Use <strong>Fund</strong> when you've added money to the AI provider account.
            Use <strong>Adjust</strong> for corrections (negative amounts allowed).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fund">Fund (added budget)</SelectItem>
                <SelectItem value="adjust">Adjust (correction)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500.00"
            />
            <div className="text-xs text-muted-foreground mt-1">
              Negative numbers allowed for adjustments.
            </div>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Topped up Lovable AI Gateway balance"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
