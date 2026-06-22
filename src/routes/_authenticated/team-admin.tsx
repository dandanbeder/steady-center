import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Crown, Users, CreditCard, ShieldCheck, Activity, ExternalLink } from "lucide-react";
import { listBusinesses } from "@/lib/businesses";
import { useActiveBusiness } from "@/hooks/use-active-business";
import { useMyRole } from "@/hooks/use-my-role";
import { listMembers } from "@/lib/memberships.functions";
import {
  getTeamOverview,
  listTeamAuditLog,
  transferOwnership,
} from "@/lib/team-admin.functions";
import { PeoplePanel } from "@/components/people-panel";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/team-admin")({
  head: () => ({ meta: [{ title: "Team admin · Heartbeat" }] }),
  component: TeamAdminPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground" role="alert">
      Couldn't load Team admin: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});


function TeamAdminPage() {
  const { activeId, setActiveId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const active = businesses.filter((b) => !b.archived_at);
  const currentBizId =
    activeId && activeId !== "all" && active.some((b) => b.id === activeId)
      ? activeId
      : active[0]?.id ?? "";

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Team admin</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Roster, roles, seats and shared resources for this team.
              Private notes, tasks, calendars, journals, mood and capacity are
              never shown here — even to the owner.
            </p>
          </div>
          {active.length > 0 && (
            <Select
              value={currentBizId}
              onValueChange={(v) => setActiveId(v)}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {active.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {currentBizId ? (
          <TeamAdminBody businessId={currentBizId} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              You don't belong to any teams yet.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function TeamAdminBody({ businessId }: { businessId: string }) {
  const my = useMyRole(businessId);
  const _overview = useServerFn(getTeamOverview);
  const overview = useQuery({
    queryKey: ["team-overview", businessId],
    queryFn: () => _overview({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
    retry: false,
  });

  if (my.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!my.can("admin")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team admin is owner & admin only</CardTitle>
          <CardDescription>
            You need the Admin or Owner role on this team to manage roster,
            seats and shared resources.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (overview.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (overview.error || !overview.data) {
    return (
      <p className="text-sm text-destructive">
        {overview.error instanceof Error ? overview.error.message : "Failed to load."}
      </p>
    );
  }

  const ov = overview.data;
  const isOwner = ov.caller.role === "owner" || ov.caller.isPlatformAdmin;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Active members"
          value={ov.members.active.toString()}
          hint={`${ov.members.invited} invited`}
        />
        <StatCard
          icon={<CreditCard className="h-4 w-4" />}
          label="Paid seats in use"
          value={ov.seats.paidUsed.toString()}
          hint={
            ov.seats.paidPurchased != null
              ? `of ${ov.seats.paidPurchased} purchased`
              : "owner-only billing detail"
          }
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Free collaborators"
          value={ov.seats.freeUsed.toString()}
          hint="viewers & commenters"
        />
        <StatCard
          icon={<Crown className="h-4 w-4" />}
          label="Your role"
          value={cap(ov.caller.role)}
          hint={ov.caller.isPlatformAdmin ? "platform admin" : undefined}
        />
      </div>

      <Tabs defaultValue="roster" className="w-full">
        <TabsList>
          <TabsTrigger value="roster">Roster & roles</TabsTrigger>
          <TabsTrigger value="seats">Seats & billing</TabsTrigger>
          <TabsTrigger value="shared">Shared resources</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          {isOwner && <TabsTrigger value="danger">Ownership</TabsTrigger>}
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Roster</CardTitle>
              <CardDescription>
                Invite, change roles, remove. The last owner cannot be
                removed or demoted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PeoplePanel businessId={businessId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seats" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Seats</CardTitle>
              <CardDescription>
                Owners, admins and members count as paid seats. Viewers and
                commenters are free.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="In use">{ov.seats.paidUsed}</Row>
              {ov.seats.paidPurchased != null && (
                <Row label="Purchased">{ov.seats.paidPurchased}</Row>
              )}
              <Row label="Free collaborators">{ov.seats.freeUsed}</Row>
              <Row label="Plan">{ov.seats.productId ?? "—"}</Row>
              <Row label="Status">{ov.seats.status ?? "—"}</Row>
              {ov.seats.currentPeriodEnd && (
                <Row label="Renews">
                  {new Date(ov.seats.currentPeriodEnd).toLocaleDateString()}
                </Row>
              )}
              {isOwner && (
                <div className="pt-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link to="/billing">
                      Open Plans & Billing <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>
              )}
              {!isOwner && (
                <p className="text-xs text-muted-foreground pt-2">
                  Billing actions are restricted to the team owner.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shared" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Shared resources</CardTitle>
              <CardDescription>
                Spaces, calendars, outcomes, notes and tasks shared into this
                team — and who can see what. Grant and revoke at the team
                level here:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/team-access">
                  Open Team & Access <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                A member's private notes, tasks, outcomes, calendar and
                journal are never listed here. Only things explicitly shared
                into the team appear.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <AuditLogPanel businessId={businessId} />
        </TabsContent>

        {isOwner && (
          <TabsContent value="danger" className="mt-4">
            <TransferOwnershipCard businessId={businessId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

function AuditLogPanel({ businessId }: { businessId: string }) {
  const _list = useServerFn(listTeamAuditLog);
  const q = useQuery({
    queryKey: ["team-audit", businessId],
    queryFn: () => _list({ data: { business_id: businessId, limit: 100 } }),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Activity className="h-5 w-5 mx-auto mb-2 opacity-60" />
          No team-admin actions yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          Every role change, removal and share grant on this team — with who
          and when. Owner and admin can view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3 text-sm flex items-start gap-3">
              <Badge variant="outline" className="shrink-0 mt-0.5">
                {r.action.replace(/_/g, " ")}
              </Badge>
              <div className="flex-1 min-w-0">
                <div>
                  <span className="font-medium">{r.actor_name || "—"}</span>
                  {r.target_name && (
                    <>
                      {" → "}
                      <span className="font-medium">{r.target_name}</span>
                    </>
                  )}
                </div>
                {r.reason && (
                  <div className="text-xs text-muted-foreground italic mt-0.5">
                    "{r.reason}"
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TransferOwnershipCard({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const _members = useServerFn(listMembers);
  const _transfer = useServerFn(transferOwnership);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");

  const members = useQuery({
    queryKey: ["members", businessId],
    queryFn: () => _members({ data: { business_id: businessId } }),
  });
  const candidates = ((members.data ?? []) as Array<{ user_id: string | null; full_name: string | null; email: string | null; role: string; status: string }>)
    .filter((m) => m.status === "active" && m.role !== "owner" && m.user_id);

  const mut = useMutation({
    mutationFn: () => _transfer({ data: { business_id: businessId, new_owner_user_id: target, reason } }),
    onSuccess: () => {
      toast.success("Ownership transferred. You are now an admin.");
      setOpen(false);
      setTarget("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["members", businessId] });
      qc.invalidateQueries({ queryKey: ["team-overview", businessId] });
      qc.invalidateQueries({ queryKey: ["team-audit", businessId] });
      qc.invalidateQueries({ queryKey: ["my-role", businessId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
        <CardDescription>
          Promote another active member to owner and step down to admin. The
          action is logged with a reason. There can never be zero owners.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)} disabled={candidates.length === 0}>
          Transfer ownership…
        </Button>
        {candidates.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            No eligible members to transfer to. Add an active member first.
          </p>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transfer team ownership</DialogTitle>
              <DialogDescription>
                The new owner gets full team-admin power. You'll be demoted
                to admin. This is recorded in the audit log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">New owner</label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger><SelectValue placeholder="Choose a member" /></SelectTrigger>
                  <SelectContent>
                    {candidates.map((m) => (
                      <SelectItem key={m.user_id!} value={m.user_id!}>
                        {m.full_name || m.email || "Member"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Reason (required)</label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why are you transferring ownership?"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!target || reason.trim().length < 3 || mut.isPending}
                onClick={() => mut.mutate()}
              >
                Transfer ownership
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
