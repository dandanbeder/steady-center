import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import {
  Building2, Folder, ListTodo, FileText, Calendar as CalendarIcon, CheckSquare,
  Trash2, Plus, ShieldOff, Loader2, Video, Target, Users, Crown, CreditCard,
  ShieldCheck, Activity, ExternalLink, Sparkles, ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  listMemberAccess, listAccountShareableResources, shareResource,
  revokeShare, updateShareRole,
  type MemberAccessRow, type ShareRole, type ResourceType,
} from "@/lib/shares.functions";
import { listAllBusinesses } from "@/lib/businesses";
import { useMyRole } from "@/hooks/use-my-role";
import { listMembers } from "@/lib/memberships.functions";
import {
  getTeamOverview, listTeamAuditLog, transferOwnership,
} from "@/lib/team-admin.functions";
import { PeoplePanel } from "@/components/people-panel";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/team-access")({
  head: () => ({ meta: [{ title: "Team & Access · Heartbeat" }] }),
  component: TeamAccessPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground" role="alert">
      Couldn't load Team &amp; Access: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

const ROLES: ShareRole[] = ["viewer", "commenter", "member", "admin"];
const TYPE_ICON: Record<ResourceType, typeof Folder> = {
  folder: Folder, list: ListTodo, task: CheckSquare, note: FileText,
  calendar: CalendarIcon, business: Building2, meeting: Video, outcome: Target,
};

function TeamAccessPage() {
  const { data: businesses = [], isLoading } = useQuery({
    queryKey: ["businesses-all"],
    queryFn: listAllBusinesses,
  });
  const active = businesses.filter((b) => !b.archived_at);
  const [bizId, setBizId] = useState<string>("");
  const currentBizId = bizId || active[0]?.id || "";

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (active.length === 0) {
    return <SoloStartPrompt />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl text-primary">Team &amp; Access</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Your team control room. Invite people, manage roles and seats,
            and decide exactly which accounts and resources they can see.
            Private items and Journals are never shown — even to the owner.
          </p>
        </div>
        <Select value={currentBizId} onValueChange={setBizId}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Pick an Account" />
          </SelectTrigger>
          <SelectContent>
            {active.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                  style={{ background: b.color || "#888" }}
                />
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {currentBizId && (
        <ControlRoom
          businessId={currentBizId}
          businessName={active.find((b) => b.id === currentBizId)?.name ?? "Account"}
        />
      )}
    </div>
  );
}

function SoloStartPrompt() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
      <Card>
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Start a team when you're ready</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Team &amp; Access is the owner's control room — roster, roles, seats,
            and per-account sharing. You're flying solo right now, so there's
            nothing to administer yet. When you add a teammate, this page lights
            up.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Button asChild>
            <Link to="/billing">
              <Sparkles className="h-4 w-4" /> Upgrade to Team
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settings">Create an Account first</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ControlRoom({ businessId, businessName }: { businessId: string; businessName: string }) {
  const my = useMyRole(businessId);
  const _overview = useServerFn(getTeamOverview);
  const overview = useQuery({
    queryKey: ["team-overview", businessId],
    queryFn: () => _overview({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
    retry: false,
  });

  if (my.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // MEMBER view: limited — they see what they belong to but can't administer.
  if (!my.can("admin")) {
    return <MemberLimitedView businessName={businessName} role={my.role ?? "member"} />;
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
          label="Paid seats"
          value={ov.seats.paidUsed.toString()}
          hint={
            ov.seats.paidPurchased != null
              ? `of ${ov.seats.paidPurchased} purchased`
              : "billing detail hidden"
          }
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Viewers & guests"
          value={ov.seats.freeUsed.toString()}
          hint="free, no seat"
        />
        <StatCard
          icon={<Crown className="h-4 w-4" />}
          label="Your role"
          value={cap(ov.caller.role)}
          hint={ov.caller.isPlatformAdmin ? "platform admin" : undefined}
        />
      </div>

      <Tabs defaultValue="roster" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="grants">Grant access</TabsTrigger>
          <TabsTrigger value="seats">Seats &amp; billing</TabsTrigger>
          <TabsTrigger value="shared">Shared resources</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          {isOwner && <TabsTrigger value="ownership">Ownership</TabsTrigger>}
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Roster &amp; roles</CardTitle>
              <CardDescription>
                Invite by email, change roles, remove members. The last owner
                can't be removed or demoted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PeoplePanel businessId={businessId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grants" className="mt-4">
          <GrantAccessTab businessId={businessId} businessName={businessName} />
        </TabsContent>

        <TabsContent value="seats" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Seats</CardTitle>
              <CardDescription>
                Owners, admins and members use paid seats. Viewers and
                commenters are free — share a single item with anyone, no seat
                required.
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
              {isOwner ? (
                <div className="pt-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link to="/billing">
                      Open Plans &amp; Billing <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>
              ) : (
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
              <CardTitle>What's shared into this team</CardTitle>
              <CardDescription>
                Everything explicitly shared with members appears in the Grant
                access tab, where you can revoke at any time. Private notes,
                tasks, calendars and Journals never appear here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link to="/shared">
                  See shared with me <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <AuditLogPanel businessId={businessId} />
        </TabsContent>

        {isOwner && (
          <TabsContent value="ownership" className="mt-4">
            <TransferOwnershipCard businessId={businessId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function MemberLimitedView({ businessName, role }: { businessName: string; role: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> {businessName}
        </CardTitle>
        <CardDescription>
          You're a <strong>{role}</strong> on this team. Use the Account
          switcher above to move between the teams you belong to. Only owners
          and admins can invite, change roles, or grant access — by design,
          your private work stays private.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>What you can do here:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>See which teams you belong to and switch between them.</li>
          <li>
            View items shared with you on the{" "}
            <Link to="/shared" className="underline">Shared with me</Link> page.
          </li>
          <li>
            Manage your own profile and notification preferences in{" "}
            <Link to="/settings" className="underline">Settings</Link>.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/* ---------------- Grant access tab (per-member) ---------------- */

function GrantAccessTab({ businessId, businessName }: { businessId: string; businessName: string }) {
  const qc = useQueryClient();
  const _list = useServerFn(listMemberAccess);
  const _share = useServerFn(shareResource);
  const _revoke = useServerFn(revokeShare);
  const _updateRole = useServerFn(updateShareRole);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["member-access", businessId],
    queryFn: () => _list({ data: { businessId } }),
    retry: false,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["member-access", businessId] });

  const grantAccount = useMutation({
    mutationFn: (v: { granteeUserId: string; role: ShareRole; canReshare: boolean; canExport: boolean }) =>
      _share({ data: {
        resourceType: "business", resourceId: businessId,
        granteeUserId: v.granteeUserId, role: v.role,
        canReshare: v.canReshare, canExport: v.canExport,
      } }),
    onSuccess: () => { invalidate(); toast.success("Account access granted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: { shareId: string; role: ShareRole; canReshare?: boolean; canExport?: boolean }) =>
      _updateRole({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (shareId: string) => _revoke({ data: { shareId } }),
    onSuccess: () => { invalidate(); toast.success("Access revoked"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalGranted = useMemo(
    () => rows.reduce((n, r) => n + (r.account_share ? 1 : 0) + r.resource_shares.length, 0),
    [rows],
  );

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          You need to be the Account owner or an admin to grant access.
        </CardContent>
      </Card>
    );
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground text-center">
          No teammates in <strong>{businessName}</strong> yet. Invite someone
          from the Roster tab to start sharing.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {rows.length} member{rows.length === 1 ? "" : "s"} ·{" "}
        {totalGranted} active grant{totalGranted === 1 ? "" : "s"} · grants
        only expose shared/work content, never private items or Journals.
      </p>
      {rows.map((m) => (
        <MemberCard
          key={m.user_id}
          businessId={businessId}
          businessName={businessName}
          member={m}
          onGrantAccount={(role, opts) =>
            grantAccount.mutate({ granteeUserId: m.user_id, role, ...opts })
          }
          onUpdate={updateMut.mutate}
          onRevoke={revokeMut.mutate}
        />
      ))}
    </div>
  );
}

function MemberCard({
  businessId, businessName, member, onGrantAccount, onUpdate, onRevoke,
}: {
  businessId: string;
  businessName: string;
  member: MemberAccessRow;
  onGrantAccount: (role: ShareRole, opts: { canReshare: boolean; canExport: boolean }) => void;
  onUpdate: (v: { shareId: string; role: ShareRole; canReshare?: boolean; canExport?: boolean }) => void;
  onRevoke: (shareId: string) => void;
}) {
  const [resOpen, setResOpen] = useState(false);
  const name = member.full_name ?? member.email ?? "Unknown";

  return (
    <article className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium truncate">{name}</div>
          {member.email && member.full_name && (
            <div className="text-xs text-muted-foreground truncate">{member.email}</div>
          )}
        </div>
        <Badge variant="outline" className="text-xs capitalize">{member.membership_role}</Badge>
      </header>

      <section className="rounded border bg-background/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4" />
            <span>Whole Account: <strong>{businessName}</strong></span>
          </div>
          {member.account_share ? (
            <div className="flex items-center gap-2">
              <Select
                value={member.account_share.role}
                onValueChange={(v) => onUpdate({ shareId: member.account_share!.share_id, role: v as ShareRole })}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => onRevoke(member.account_share!.share_id)} aria-label="Revoke Account access">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <GrantAccountInline onGrant={onGrantAccount} />
          )}
        </div>
        {member.account_share && (
          <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
            <ToggleRow
              label="Can re-share / invite"
              checked={member.account_share.can_reshare}
              onChange={(v) => onUpdate({ shareId: member.account_share!.share_id, role: member.account_share!.role, canReshare: v })}
            />
            <ToggleRow
              label="Can export"
              checked={member.account_share.can_export}
              onChange={(v) => onUpdate({ shareId: member.account_share!.share_id, role: member.account_share!.role, canExport: v })}
            />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Specific resources{" "}
            <span className="text-muted-foreground font-normal">({member.resource_shares.length})</span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => setResOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Grant resource
          </Button>
        </div>

        {member.resource_shares.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing else is shared individually with this member.
          </p>
        ) : (
          <ul className="divide-y rounded border">
            {member.resource_shares.map((s) => {
              const Icon = TYPE_ICON[s.resource_type];
              return (
                <li key={s.share_id} className="flex flex-wrap items-center gap-3 p-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate min-w-[140px]">{s.resource_title}</span>
                  <span className="text-xs text-muted-foreground capitalize">{s.resource_type}</span>
                  {s.can_reshare && <Badge variant="secondary" className="text-[10px]">re-share</Badge>}
                  {s.can_export && <Badge variant="secondary" className="text-[10px]">export</Badge>}
                  <Select
                    value={s.role}
                    onValueChange={(v) => onUpdate({ shareId: s.share_id, role: v as ShareRole })}
                  >
                    <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => onRevoke(s.share_id)} aria-label="Revoke">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {member.resource_shares.length === 0 && !member.account_share && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldOff className="h-3 w-3" />
            Membership alone grants nothing — this person currently sees nothing in {businessName}.
          </p>
        )}
      </section>

      <GrantResourceDialog
        open={resOpen}
        onOpenChange={setResOpen}
        businessId={businessId}
        granteeUserId={member.user_id}
        onDone={() => setResOpen(false)}
      />
    </article>
  );
}

function ToggleRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function GrantAccountInline({
  onGrant,
}: { onGrant: (role: ShareRole, opts: { canReshare: boolean; canExport: boolean }) => void }) {
  const [role, setRole] = useState<ShareRole>("viewer");
  const [canReshare, setCR] = useState(false);
  const [canExport, setCE] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Grant Account
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant whole-Account access</DialogTitle>
          <DialogDescription>
            They'll see everything currently shared inside this Account, capped at this role.
            Private items and the Journal are never included.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ToggleRow label="Can re-share / invite others" checked={canReshare} onChange={setCR} />
          <ToggleRow label="Can export" checked={canExport} onChange={setCE} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { onGrant(role, { canReshare, canExport }); setOpen(false); }}>
            Grant access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantResourceDialog({
  open, onOpenChange, businessId, granteeUserId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  granteeUserId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const _resources = useServerFn(listAccountShareableResources);
  const _share = useServerFn(shareResource);
  const { data: resources = [], isLoading } = useQuery({
    queryKey: ["account-resources", businessId],
    queryFn: () => _resources({ data: { businessId } }),
    enabled: open,
  });

  const [picked, setPicked] = useState<string>("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [canReshare, setCR] = useState(false);
  const [canExport, setCE] = useState(false);

  const grant = useMutation({
    mutationFn: () => {
      const [type, id] = picked.split(":");
      return _share({ data: {
        resourceType: type as ResourceType, resourceId: id,
        granteeUserId, role, canReshare, canExport,
      } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["member-access", businessId] });
      toast.success("Resource shared");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share a specific resource</DialogTitle>
          <DialogDescription>
            Pick a folder, calendar, or note inside this Account. Journal entries are never shareable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Resource</Label>
            <Select value={picked} onValueChange={setPicked} disabled={isLoading}>
              <SelectTrigger><SelectValue placeholder={isLoading ? "Loading…" : "Choose a resource"} /></SelectTrigger>
              <SelectContent>
                {resources.map((r) => (
                  <SelectItem key={`${r.type}:${r.id}`} value={`${r.type}:${r.id}`}>
                    <span className="capitalize text-muted-foreground mr-2 text-xs">{r.type}</span>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ToggleRow label="Can re-share / invite others" checked={canReshare} onChange={setCR} />
          <ToggleRow label="Can export" checked={canExport} onChange={setCE} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => grant.mutate()} disabled={!picked || grant.isPending}>
            {grant.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Shared building blocks ---------------- */

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
          No team-admin actions yet. Invites, role changes, removals, grants
          and revokes will appear here with who and when.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          Every invite, role change, removal, grant and revoke on this team —
          with who, when and why.
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
          action is recorded with a reason. The team can never have zero
          owners.
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
                The new owner gets full team-admin power. You'll be demoted to
                admin. This is recorded in the audit log.
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
