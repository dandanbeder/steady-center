import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldAlert, RefreshCw, AlertTriangle } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  adminListFailedWebhooks,
  adminReplayWebhook,
} from "@/lib/admin-system.functions";
import { adminListAuditLog } from "@/lib/admin.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { PaddleEnv } from "@/lib/paddle.server";

export const Route = createFileRoute("/_authenticated/admin/system")({
  component: SystemPage,
});

function SystemPage() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">System health & audit</h1>
          <p className="text-sm text-muted-foreground">
            Webhook failures (paid-but-not-provisioned catches) and complete admin audit trail.
          </p>
        </div>
      </div>
      <Tabs defaultValue="webhooks" className="w-full">
        <TabsList>
          <TabsTrigger value="webhooks">Webhook failures</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="webhooks" className="mt-6"><WebhookFailures /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditViewer /></TabsContent>
      </Tabs>
      <div className="pt-2">
        <Link to="/admin" className="text-sm underline text-primary">← Back to admin home</Link>
      </div>
    </div>
  );
}

function WebhookFailures() {
  const [env, setEnv] = useState<PaddleEnv>(getPaddleEnvironment());
  const listFn = useServerFn(adminListFailedWebhooks);
  const replayFn = useServerFn(adminReplayWebhook);
  const qc = useQueryClient();
  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "failed-webhooks", env],
    queryFn: () => listFn({ data: { environment: env } }),
  });

  const [replayTarget, setReplayTarget] = useState<{ id: string; event_type: string } | null>(null);
  const [reason, setReason] = useState("");
  const replay = useMutation({
    mutationFn: () => replayFn({
      data: { notification_id: replayTarget!.id, environment: env, reason },
    }),
    onSuccess: () => {
      toast.success("Replay queued");
      setReplayTarget(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin", "failed-webhooks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Environment</Label>
          <Select value={env} onValueChange={(v) => setEnv(v as PaddleEnv)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">test</SelectItem>
              <SelectItem value="live">live</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : data.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No failed or pending webhooks. All events delivered.
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Occurred</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-mono text-xs">{n.event_type}</TableCell>
                  <TableCell>
                    <Badge variant={n.status === "needs_attention" ? "destructive" : "secondary"}>
                      <AlertTriangle className="h-3 w-3 mr-1" />{n.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{n.attempts}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(n.occurred_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {n.matched_subscription_user_email ? (
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: n.matched_subscription_user_id! }}
                        className="text-primary underline"
                      >
                        {n.matched_subscription_user_email}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">unattributed</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-[240px] truncate">
                    {n.payload_summary}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplayTarget({ id: n.id, event_type: n.event_type })}
                    >
                      Replay
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!replayTarget} onOpenChange={(o) => !o && setReplayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replay webhook</DialogTitle>
            <DialogDescription>
              Re-deliver <code className="text-xs">{replayTarget?.event_type}</code>. The webhook
              handler is idempotent — safe to retry. Action is audited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer paid but plan didn't activate — ticket #1234"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplayTarget(null)}>Cancel</Button>
            <Button
              onClick={() => replay.mutate()}
              disabled={reason.trim().length < 3 || replay.isPending}
            >
              Replay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditViewer() {
  const fn = useServerFn(adminListAuditLog);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit", "all"],
    queryFn: () => fn({ data: { limit: 200 } }),
  });
  if (isLoading) return <div className="text-muted-foreground">Loading audit log…</div>;
  const rows = (data as any)?.rows ?? data ?? [];
  const userMap: Record<string, { email?: string; full_name?: string }> = (data as any)?.users ?? {};

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Admin</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                No audit entries yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="text-xs">
                {userMap[r.admin_id]?.email ?? r.admin_id?.slice(0, 8)}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="text-xs">
                {r.target_user_id ? (
                  <Link
                    to="/admin/users/$userId"
                    params={{ userId: r.target_user_id }}
                    className="text-primary underline"
                  >
                    {userMap[r.target_user_id]?.email ?? r.target_user_id.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate">
                {r.reason ?? ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
