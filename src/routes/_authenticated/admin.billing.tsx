import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ShieldAlert, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { adminListBillingAccounts, adminGrantCredits, type BillingAccountRow } from "@/lib/admin-billing.functions";
import {
  adminCompSubscription,
  adminExtendTrial,
  adminUpsertEntitlementOverride,
} from "@/lib/admin.functions";
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

export const Route = createFileRoute("/_authenticated/admin/billing")({
  component: AdminBillingConsole,
});

const STATUS_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  canceled: "outline",
  free: "outline",
};

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : ",";
}

function AdminBillingConsole() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const listFn = useServerFn(adminListBillingAccounts);
  const { data = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["admin", "billing", "accounts"],
    queryFn: () => listFn(),
    enabled: !!isAdmin,
    staleTime: 30_000,
  });

  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [flag, setFlag] = useState<string>("all"); // all | trial_soon | past_due

  const rows = useMemo<BillingAccountRow[]>(() => {
    const needle = q.trim().toLowerCase();
    return (data as BillingAccountRow[]).filter((r) => {
      if (plan !== "all" && r.plan !== plan) return false;
      if (status !== "all" && r.status !== status) return false;
      if (flag === "trial_soon" && !r.trial_expires_soon) return false;
      if (flag === "past_due" && r.status !== "past_due") return false;
      if (needle && !(r.email.toLowerCase().includes(needle) || r.full_name.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data, q, plan, status, flag]);

  const counts = useMemo(() => {
    const d = data as BillingAccountRow[];
    return {
      total: d.length,
      pastDue: d.filter((r) => r.status === "past_due").length,
      trialSoon: d.filter((r) => r.trial_expires_soon).length,
      paid: d.filter((r) => r.plan === "pro" || r.plan === "team").length,
    };
  }, [data]);

  const [target, setTarget] = useState<BillingAccountRow | null>(null);
  const [actionKind, setActionKind] = useState<null | "comp" | "trial" | "credits" | "override">(null);

  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Billing & Plans</h1>
          <p className="text-sm text-muted-foreground">
            Operational billing data only, no private content. Every manual change is audited.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Accounts" value={counts.total} />
        <Stat label="Paid (Pro+Team)" value={counts.paid} />
        <Stat label="Trial ending ≤3d" value={counts.trialSoon} tone={counts.trialSoon > 0 ? "warn" : undefined} />
        <Stat label="Past due" value={counts.pastDue} tone={counts.pastDue > 0 ? "danger" : undefined} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or name" className="pl-8" />
          </div>
        </div>
        <FilterSelect label="Plan" value={plan} onChange={setPlan} options={["all", "free", "pro", "team", "other"]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={["all", "free", "trialing", "active", "past_due", "canceled"]} />
        <FilterSelect label="Flags" value={flag} onChange={setFlag} options={["all", "trial_soon", "past_due"]} />
        <Link to="/admin" className="text-sm underline text-primary ml-auto">← Back to admin</Link>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Plan / Status</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Trial / Cycle</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsLoading ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground py-6">Loading accounts…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground py-6">No accounts match.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell>
                  <div className="font-medium">{r.full_name || ","}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant="outline" className="w-fit capitalize">{r.plan}</Badge>
                    <Badge variant={STATUS_COLOR[r.status] ?? "outline"} className="w-fit">{r.status}</Badge>
                    {r.cancel_at_period_end && <span className="text-[10px] text-muted-foreground">cancels at period end</span>}
                  </div>
                </TableCell>
                <TableCell>{r.seats || ","}</TableCell>
                <TableCell className="text-xs">
                  {r.status === "trialing" && r.trial_end && (
                    <div className={r.trial_expires_soon ? "text-amber-600 font-medium flex items-center gap-1" : ""}>
                      {r.trial_expires_soon && <AlertTriangle className="h-3 w-3" />}
                      trial → {fmtDate(r.trial_end)}
                    </div>
                  )}
                  {r.status === "past_due" && r.past_due_since && (
                    <div className="text-destructive">past-due since {fmtDate(r.past_due_since)}</div>
                  )}
                  <div className="text-muted-foreground">
                    {fmtDate(r.current_period_start)} → {fmtDate(r.current_period_end)}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div>{r.businesses_count} business{r.businesses_count === 1 ? "" : "es"}</div>
                  <div className="text-muted-foreground">{r.calendar_connections_count} calendar conn.</div>
                  {r.overrides_count > 0 && <div className="text-primary">{r.overrides_count} override{r.overrides_count === 1 ? "" : "s"}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  <div>{r.credit_balance} allow.</div>
                  <div className="text-muted-foreground">{r.purchased_credits} purchased</div>
                </TableCell>
                <TableCell className="text-right">
                  <Select onValueChange={(v) => { setTarget(r); setActionKind(v as typeof actionKind); }} value="">
                    <SelectTrigger className="w-[140px] ml-auto"><SelectValue placeholder="Adjust…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comp">Comp plan</SelectItem>
                      <SelectItem value="trial">Extend trial</SelectItem>
                      <SelectItem value="credits">Grant credits</SelectItem>
                      <SelectItem value="override">Override limit</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ActionDialog
        target={target}
        kind={actionKind}
        onClose={() => { setTarget(null); setActionKind(null); }}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  const cls = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o} className="capitalize">{o.replace("_", " ")}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ActionDialog({
  target, kind, onClose,
}: {
  target: BillingAccountRow | null;
  kind: null | "comp" | "trial" | "credits" | "override";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const compFn = useServerFn(adminCompSubscription);
  const trialFn = useServerFn(adminExtendTrial);
  const creditsFn = useServerFn(adminGrantCredits);
  const overrideFn = useServerFn(adminUpsertEntitlementOverride);

  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<"pro_plan" | "team_plan">("pro_plan");
  const [months, setMonths] = useState(1);
  const [days, setDays] = useState(14);
  const [credits, setCredits] = useState(500);
  const [creditMonths, setCreditMonths] = useState(12);
  const [overrideKey, setOverrideKey] = useState("max_businesses");
  const [overrideValue, setOverrideValue] = useState(0);

  const mut = useMutation({
    mutationFn: async () => {
      if (!target || !kind) return;
      if (kind === "comp") return compFn({ data: { user_id: target.user_id, plan, months, reason } });
      if (kind === "trial") return trialFn({ data: { user_id: target.user_id, days, reason } });
      if (kind === "credits") return creditsFn({ data: { user_id: target.user_id, credits, months: creditMonths, reason } });
      if (kind === "override")
        return overrideFn({
          data: { user_id: target.user_id, key: overrideKey, value: overrideValue, note: reason },
        });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      toast.success("Change applied and audited");
      setReason("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = !!target && !!kind;
  const title = kind === "comp" ? "Comp a plan"
    : kind === "trial" ? "Extend trial"
    : kind === "credits" ? "Grant credits"
    : kind === "override" ? "Override limit" : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target?.email}, this manual change is recorded in the audit log with your user id and reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "comp" && (
            <>
              <div>
                <Label>Plan</Label>
                <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pro_plan">Pro</SelectItem>
                    <SelectItem value="team_plan">Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput label="Months" value={months} onChange={setMonths} min={1} max={120} />
            </>
          )}
          {kind === "trial" && <NumberInput label="Extend by (days)" value={days} onChange={setDays} min={1} max={365} />}
          {kind === "credits" && (
            <>
              <NumberInput label="Credits" value={credits} onChange={setCredits} min={1} max={1_000_000} />
              <NumberInput label="Expires in (months)" value={creditMonths} onChange={setCreditMonths} min={1} max={120} />
            </>
          )}
          {kind === "override" && (
            <>
              <div>
                <Label>Entitlement key</Label>
                <Select value={overrideKey} onValueChange={setOverrideKey}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="max_businesses">max_businesses</SelectItem>
                    <SelectItem value="max_calendar_connections">max_calendar_connections</SelectItem>
                    <SelectItem value="max_seats">max_seats</SelectItem>
                    <SelectItem value="ai_monthly_allowance">ai_monthly_allowance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput label="Value" value={overrideValue} onChange={setOverrideValue} min={-1000000} max={1000000} />
            </>
          )}
          <div>
            <Label>Reason {kind !== "override" && <span className="text-destructive">*</span>}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Goodwill credit after billing incident (ticket #1234)"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (kind !== "override" && reason.trim().length < 3)}
          >
            Apply &amp; audit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberInput({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(globalThis.Number(e.target.value))}
      />
    </div>
  );
}
