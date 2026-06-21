import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Shield, Check, X, Eye, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listMyJournalGrants,
  listMyJournalAccessLog,
  respondToJournalAccess,
  revokeJournalAccess,
} from "@/lib/journal-access.functions";

export function JournalAccessPanel() {
  const qc = useQueryClient();
  const listGrants = useServerFn(listMyJournalGrants);
  const listLog = useServerFn(listMyJournalAccessLog);
  const respondFn = useServerFn(respondToJournalAccess);
  const revokeFn = useServerFn(revokeJournalAccess);

  const grantsQ = useQuery({ queryKey: ["journal-grants"], queryFn: () => listGrants() });
  const logQ = useQuery({ queryKey: ["journal-access-log"], queryFn: () => listLog() });

  const respondMut = useMutation({
    mutationFn: (v: { grantId: string; decision: "accepted" | "declined" }) =>
      respondFn({ data: v }),
    onSuccess: (_, v) => {
      toast.success(v.decision === "accepted" ? "Access granted for 24 hours" : "Request declined");
      qc.invalidateQueries({ queryKey: ["journal-grants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const revokeMut = useMutation({
    mutationFn: (grantId: string) => revokeFn({ data: { grantId } }),
    onSuccess: () => {
      toast.success("Access revoked");
      qc.invalidateQueries({ queryKey: ["journal-grants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const grants = grantsQ.data ?? [];
  const pending = useMemo(() => grants.filter((g) => g.status === "pending"), [grants]);
  const active = useMemo(
    () =>
      grants.filter(
        (g) =>
          g.status === "accepted" &&
          (!g.expires_at || new Date(g.expires_at).getTime() > Date.now()),
      ),
    [grants],
  );
  const history = useMemo(
    () =>
      grants.filter(
        (g) =>
          g.status !== "pending" &&
          !active.some((a) => a.id === g.id),
      ),
    [grants, active],
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Journal access
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Your Journal is private. A super admin can only see it if you explicitly accept a request.
          You can revoke access at any time, and you'll be notified each time it's actually viewed.
        </p>
      </div>

      {pending.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Pending requests</div>
          {pending.map((g) => (
            <div key={g.id} className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="text-sm">
                <span className="font-medium">{g.admin_name}</span> is requesting{" "}
                <span className="font-medium">{g.mode}</span> access to your Journal.
              </div>
              <div className="text-sm italic text-muted-foreground border-l-2 pl-3">"{g.reason}"</div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => respondMut.mutate({ grantId: g.id, decision: "accepted" })}
                  disabled={respondMut.isPending}
                  className="gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" /> Accept (24h)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => respondMut.mutate({ grantId: g.id, decision: "declined" })}
                  disabled={respondMut.isPending}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" /> Decline
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Active access</div>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active grants. Your Journal is private.</p>
        ) : (
          active.map((g) => (
            <div key={g.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <div>
                  <span className="font-medium">{g.admin_name}</span> ({g.mode}), expires{" "}
                  {g.expires_at ? formatDistanceToNow(new Date(g.expires_at), { addSuffix: true }) : "never"}
                </div>
                <div className="text-xs text-muted-foreground italic">"{g.reason}"</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revokeMut.mutate(g.id)}
                disabled={revokeMut.isPending}
                className="text-destructive hover:text-destructive"
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Eye className="h-3 w-3" /> Recent views
        </div>
        {(logQ.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No one has viewed your Journal.</p>
        ) : (
          <ul className="space-y-1">
            {(logQ.data ?? []).slice(0, 20).map((r) => (
              <li key={r.id} className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="h-3 w-3" />
                {r.admin_name} {r.action === "edit" ? "edited" : r.action === "list" ? "opened the list" : "opened an entry"} ,{" "}
                {formatDistanceToNow(new Date(r.accessed_at), { addSuffix: true })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">History</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {history.slice(0, 10).map((g) => (
              <li key={g.id}>
                {g.admin_name}, {g.status}, {formatDistanceToNow(new Date(g.requested_at), { addSuffix: true })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
