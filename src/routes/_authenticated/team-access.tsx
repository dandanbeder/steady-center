import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import {
  Building2, Folder, ListTodo, FileText, Calendar as CalendarIcon, CheckSquare,
  Trash2, Plus, ShieldOff, Loader2, Video,
} from "lucide-react";
import { toast } from "sonner";
import {
  listMemberAccess,
  listAccountShareableResources,
  shareResource,
  revokeShare,
  updateShareRole,
  type MemberAccessRow,
  type ShareRole,
  type ResourceType,
} from "@/lib/shares.functions";
import { listAllBusinesses } from "@/lib/businesses";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/team-access")({
  head: () => ({ meta: [{ title: "Team & Access · Heartbeat" }] }),
  component: TeamAccessPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground" role="alert">
      Couldn't load team access: {error.message}
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
  const qc = useQueryClient();
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses-all"],
    queryFn: listAllBusinesses,
  });
  const active = businesses.filter((b) => !b.archived_at);
  const [bizId, setBizId] = useState<string>("");
  const currentBizId = bizId || active[0]?.id || "";
  const currentBiz = active.find((b) => b.id === currentBizId);

  const _list = useServerFn(listMemberAccess);
  const _share = useServerFn(shareResource);
  const _revoke = useServerFn(revokeShare);
  const _updateRole = useServerFn(updateShareRole);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["member-access", currentBizId],
    queryFn: () => _list({ data: { businessId: currentBizId } }),
    enabled: !!currentBizId,
    retry: false,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["member-access", currentBizId] });

  const grantAccount = useMutation({
    mutationFn: (v: { granteeUserId: string; role: ShareRole; canReshare: boolean; canExport: boolean }) =>
      _share({ data: {
        resourceType: "business", resourceId: currentBizId,
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl text-primary">Team &amp; Access</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          See exactly what each teammate can access today, and grant or revoke per member.
          Membership alone grants nothing, access is only what you explicitly share.
          The Journal is never shareable.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm">Account</Label>
        <Select value={currentBizId} onValueChange={setBizId}>
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Pick an Account" /></SelectTrigger>
          <SelectContent>
            {active.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: b.color || "#888" }} />
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {rows.length} member{rows.length === 1 ? "" : "s"} · {totalGranted} active grant{totalGranted === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <div className="rounded border p-6 text-sm text-muted-foreground">
          You need to be the Account owner or an admin to manage team access.
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded border p-6 text-sm text-muted-foreground">
          No teammates in this Account yet. Invite someone from{" "}
          <Link to="/settings" className="underline">Settings</Link>.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((m) => (
            <MemberCard
              key={m.user_id}
              businessId={currentBizId}
              businessName={currentBiz?.name ?? "Account"}
              member={m}
              onGrantAccount={(role, opts) =>
                grantAccount.mutate({ granteeUserId: m.user_id, role, ...opts })
              }
              onUpdate={updateMut.mutate}
              onRevoke={revokeMut.mutate}
            />
          ))}
        </div>
      )}
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

      {/* Account-scope */}
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

      {/* Per-resource shares */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Specific resources <span className="text-muted-foreground font-normal">({member.resource_shares.length})</span>
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
            Membership alone grants nothing, this person currently sees nothing in {businessName}.
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
            The Journal is never included.
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

  const [picked, setPicked] = useState<string>(""); // "type:id"
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
