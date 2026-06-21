import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ShieldAlert,
  ArrowLeft,
  AlertTriangle,
  Gauge,
  Ban,
  Trash2,
  Eye,
  PlayCircle,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  adminListAbuseFlags,
  adminScanAbuse,
  adminResolveFlag,
  adminWarnUser,
  adminThrottleUser,
  adminTerminateUser,
  adminGetAbuseThresholds,
  adminSetAbuseThresholds,
  type AbuseFlagRow,
} from "@/lib/admin-abuse.functions";
import { adminSuspendUser, adminReactivateUser } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/abuse")({
  component: AbusePage,
});

function AbusePage() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Abuse controls</h1>
            <p className="text-sm text-muted-foreground">
              Review flagged accounts and apply graduated, audited enforcement.
              Hitting the credit hard-stop is <strong>not</strong> abuse — those users are
              upsell candidates, not targets.
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

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
          <TabsTrigger value="thresholds">Auto-flag thresholds</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-6">
          <QueueTab />
        </TabsContent>
        <TabsContent value="thresholds" className="mt-6">
          <ThresholdsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============= Queue =============

function QueueTab() {
  const [status, setStatus] = useState<"open" | "dismissed" | "actioned" | "all">("open");
  const list = useServerFn(adminListAbuseFlags);
  const scan = useServerFn(adminScanAbuse);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["abuse-flags", status],
    queryFn: () => list({ data: { status } }),
    staleTime: 30_000,
  });
  const scanMut = useMutation({
    mutationFn: () => scan(),
    onSuccess: (r) => {
      toast.success(`Scan complete — ${r.flagged} flag(s) updated`);
      qc.invalidateQueries({ queryKey: ["abuse-flags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="actioned">Actioned</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => scanMut.mutate()} disabled={scanMut.isPending}>
          <PlayCircle className="h-4 w-4 mr-2" />
          {scanMut.isPending ? "Scanning…" : "Run auto-flag scanner"}
        </Button>
      </div>

      {q.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : !q.data?.length ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No {status === "all" ? "" : status} flags. Run the scanner to detect new signals.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((f) => (
                <FlagRow key={f.id} flag={f} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Signals: cap-hits (rate-limit), distinct IPs (sharing), credit burn (automated hammering).
        The scanner only flags; enforcement is always a human decision.
      </p>
    </div>
  );
}

function FlagRow({ flag }: { flag: AbuseFlagRow }) {
  const [open, setOpen] = useState<null | "warn" | "throttle" | "suspend" | "terminate" | "resolve">(null);
  const sevColor =
    flag.severity === "high" ? "destructive" : flag.severity === "medium" ? "default" : "secondary";
  return (
    <>
      <TableRow>
        <TableCell>
          <div className="font-medium">{flag.full_name || "—"}</div>
          <div className="text-xs text-muted-foreground">{flag.email || flag.user_id}</div>
        </TableCell>
        <TableCell><Badge variant={sevColor as any}>{flag.severity}</Badge></TableCell>
        <TableCell><Badge variant="outline">{flag.source}</Badge></TableCell>
        <TableCell className="max-w-md">
          <div className="text-sm">{flag.evidence_summary}</div>
          {flag.signals?.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              {flag.signals.map((s) => `${s.kind}: ${s.observed}/${s.threshold}`).join(" · ")}
            </div>
          )}
        </TableCell>
        <TableCell>
          <div className="flex gap-1 flex-wrap">
            <Badge variant={flag.user_status === "suspended" ? "destructive" : "outline"}>
              {flag.user_status}
            </Badge>
            {flag.throttle_level !== "none" && (
              <Badge variant="outline">throttled</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(flag.created_at).toLocaleString()}
        </TableCell>
        <TableCell className="text-right">
          {flag.status === "open" ? (
            <div className="flex gap-1 justify-end flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setOpen("warn")}>
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />Warn
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen("throttle")}>
                <Gauge className="h-3.5 w-3.5 mr-1" />Throttle
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen("suspend")}>
                <Ban className="h-3.5 w-3.5 mr-1" />Suspend
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setOpen("terminate")}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Terminate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen("resolve")}>
                <Eye className="h-3.5 w-3.5 mr-1" />Dismiss
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {flag.resolution_action || flag.status}
            </span>
          )}
        </TableCell>
      </TableRow>
      {open && <ActionDialog flag={flag} action={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ============= Action dialogs =============

function ActionDialog({
  flag,
  action,
  onClose,
}: {
  flag: AbuseFlagRow;
  action: "warn" | "throttle" | "suspend" | "terminate" | "resolve";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const warnFn = useServerFn(adminWarnUser);
  const throttleFn = useServerFn(adminThrottleUser);
  const suspendFn = useServerFn(adminSuspendUser);
  const reactivateFn = useServerFn(adminReactivateUser);
  const termFn = useServerFn(adminTerminateUser);
  const resolveFn = useServerFn(adminResolveFlag);

  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [throttleLevel, setThrottleLevel] = useState<"none" | "tight">("tight");
  const [confirm, setConfirm] = useState("");

  const isPaying = false; // surfaced in UI copy; actual check lives in Terms enforcement

  const invalidate = () => qc.invalidateQueries({ queryKey: ["abuse-flags"] });

  const mut = useMutation({
    mutationFn: async () => {
      if (action === "warn") {
        await warnFn({ data: { user_id: flag.user_id, message, reason } });
      } else if (action === "throttle") {
        await throttleFn({ data: { user_id: flag.user_id, level: throttleLevel, reason } });
      } else if (action === "suspend") {
        if (flag.user_status === "suspended") {
          await reactivateFn({ data: { user_id: flag.user_id, reason } });
        } else {
          await suspendFn({ data: { user_id: flag.user_id, reason, message: message || undefined } });
        }
      } else if (action === "terminate") {
        if (confirm !== "TERMINATE") throw new Error('Type TERMINATE to confirm.');
        await termFn({ data: { user_id: flag.user_id, reason, confirm_phrase: "TERMINATE" } });
      } else if (action === "resolve") {
        await resolveFn({ data: { flag_id: flag.id, action: "dismissed", note: reason } });
        invalidate();
        return;
      }
      // After any enforcement step, mark the flag as actioned for auditability.
      await resolveFn({
        data: {
          flag_id: flag.id,
          action: "actioned",
          note: `${action}: ${reason}`.slice(0, 500),
        },
      });
      }
      invalidate();
    },
    onSuccess: () => {
      toast.success(`Recorded: ${action}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const titles: Record<typeof action, string> = {
    warn: "Send warning",
    throttle: "Throttle account",
    suspend: flag.user_status === "suspended" ? "Reactivate account" : "Suspend account",
    terminate: "Terminate account",
    resolve: "Dismiss flag",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>
            {action === "terminate" &&
              "Last resort. Schedules deletion in 30 days. The user is banned from auth immediately. Per Terms, paying customers require notice & may be due a refund — confirm offline before proceeding."}
            {action === "suspend" &&
              flag.user_status !== "suspended" &&
              "Pauses access. Data is kept. Reversible. For paying customers, follow the abuse clause in our Terms (notice / refund implications)."}
            {action === "suspend" && flag.user_status === "suspended" && "Restore access immediately."}
            {action === "warn" && "Records a warning on the account. User will see the message on next sign-in."}
            {action === "throttle" && "Tightens rate limits without revoking access. Reversible."}
            {action === "resolve" && "Mark this flag as dismissed (not abuse). No enforcement action taken."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {action === "warn" && (
            <div>
              <Label>Message to user</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
            </div>
          )}
          {action === "throttle" && (
            <div>
              <Label>Throttle level</Label>
              <Select value={throttleLevel} onValueChange={(v) => setThrottleLevel(v as "none" | "tight")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tight">Tight (lower rate limits)</SelectItem>
                  <SelectItem value="none">Clear throttle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {action === "suspend" && flag.user_status !== "suspended" && (
            <div>
              <Label>Optional user-facing message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </div>
          )}
          {action === "terminate" && (
            <div>
              <Label>Type TERMINATE to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="TERMINATE" />
            </div>
          )}
          <div>
            <Label>Reason (required, audited)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || reason.length < 3 || (action === "warn" && message.length < 5) || (action === "terminate" && confirm !== "TERMINATE")}
            variant={action === "terminate" ? "destructive" : "default"}
          >
            {mut.isPending ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= Thresholds =============

function ThresholdsTab() {
  const get = useServerFn(adminGetAbuseThresholds);
  const set = useServerFn(adminSetAbuseThresholds);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["abuse-thresholds"], queryFn: () => get() });
  const [form, setForm] = useState<any>(null);
  const [reason, setReason] = useState("");

  if (q.isPending) return <div className="text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="text-destructive">No config row.</div>;
  const cur = form ?? q.data;

  const update = (k: string, v: any) => setForm({ ...cur, [k]: v });

  const mut = useMutation({
    mutationFn: () =>
      set({
        data: {
          enabled: cur.enabled,
          cap_hits_24h_high: Number(cur.cap_hits_24h_high),
          cap_hits_24h_medium: Number(cur.cap_hits_24h_medium),
          distinct_ips_7d_high: Number(cur.distinct_ips_7d_high),
          distinct_ips_7d_medium: Number(cur.distinct_ips_7d_medium),
          credit_burn_24h_high: Number(cur.credit_burn_24h_high),
          credit_burn_24h_medium: Number(cur.credit_burn_24h_medium),
          reason,
        },
      }),
    onSuccess: () => {
      toast.success("Thresholds updated");
      setReason("");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["abuse-thresholds"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const N = ({ label, k }: { label: string; k: string }) => (
    <div>
      <Label>{label}</Label>
      <Input type="number" value={cur[k]} onChange={(e) => update(k, e.target.value)} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-4 w-4" /> Auto-flag thresholds
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When a signal crosses these levels the scanner auto-flags the account for human review.
          It <strong>never</strong> auto-suspends or auto-throttles.
        </p>
        <div className="flex items-center gap-3">
          <Switch checked={cur.enabled} onCheckedChange={(v) => update("enabled", v)} />
          <Label>Scanner enabled</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <N label="Cap hits / 24h — medium" k="cap_hits_24h_medium" />
          <N label="Cap hits / 24h — high" k="cap_hits_24h_high" />
          <N label="Distinct IPs / 7d — medium" k="distinct_ips_7d_medium" />
          <N label="Distinct IPs / 7d — high" k="distinct_ips_7d_high" />
          <N label="Credit burn / 24h — medium" k="credit_burn_24h_medium" />
          <N label="Credit burn / 24h — high" k="credit_burn_24h_high" />
        </div>
        <div>
          <Label>Reason for change (audited)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          {form && <Button variant="ghost" onClick={() => setForm(null)}>Reset</Button>}
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || reason.length < 3 || !form}>
            {mut.isPending ? "Saving…" : "Save thresholds"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
