import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ShieldAlert, Plus, Trash2, Edit3, Eye, Search, Download } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { SubscribersPanel } from "@/components/admin/subscribers-panel";
import { useActiveSupportSession } from "@/hooks/use-support-session";
import {
  adminListUsers,
  adminSetPlatformRole,
  adminListAnnouncements,
  adminUpsertAnnouncement,
  adminDeleteAnnouncement,
  adminListFlags,
  adminUpsertFlag,
  adminDeleteFlag,
  adminStartSupportSession,
  adminListAccessLog,
} from "@/lib/admin.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { beginSupportSession, type SupportSessionStartResult } from "@/lib/support-session";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPortal,
});

function AdminPortal() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Checking access…</div>;
  }
  if (!isAdmin) return <Navigate to="/today" />;
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Super Admin</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, app-wide updates, and audited support access.
          </p>
        </div>
      </div>
      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="subscribers">Subscribers</TabsTrigger>
          <TabsTrigger value="control">App Control</TabsTrigger>
          <TabsTrigger value="audit">Support Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-6"><UsersPanel /></TabsContent>
        <TabsContent value="subscribers" className="mt-6"><SubscribersPanel /></TabsContent>
        <TabsContent value="control" className="mt-6"><AppControlPanel /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditPanel /></TabsContent>
      </Tabs>
      <div className="pt-2 flex gap-4 flex-wrap">
        <Link to="/admin/teams" className="text-sm underline text-primary">Open Teams →</Link>
        <Link to="/admin/billing" className="text-sm underline text-primary">Open Billing &amp; Plans →</Link>
        <Link to="/admin/ai-economics" className="text-sm underline text-primary">Open AI Economics →</Link>
        <Link to="/admin/financials" className="text-sm underline text-primary">Open Financials &amp; Analytics →</Link>
        <Link to="/admin/analytics" className="text-sm underline text-primary">Open Analytics →</Link>
        <Link to="/admin/abuse" className="text-sm underline text-primary">Open Abuse controls →</Link>
        <Link to="/admin/system" className="text-sm underline text-primary">Open System health &amp; audit →</Link>
        <Link to="/admin/payments" className="text-sm underline text-primary">Open Payments diagnostic →</Link>
      </div>
    </div>
  );
}

// =================== USERS ===================
function UsersPanel() {
  const listFn = useServerFn(adminListUsers);
  const roleFn = useServerFn(adminSetPlatformRole);
  const startFn = useServerFn(adminStartSupportSession);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listFn(),
  });

  const roleMut = useMutation({
    mutationFn: (v: { user_id: string; platform_role: "user" | "superadmin" }) => roleFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); toast.success("Role updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [supportTarget, setSupportTarget] = useState<{ id: string; email: string } | null>(null);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"read" | "write">("read");
  const startMut = useMutation({
    mutationFn: () => startFn({
      data: { target_user_id: supportTarget!.id, reason, mode, redirect_origin: window.location.origin },
    }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Support session started");
      setSupportTarget(null);
      setReason("");
      setMode("read");
      beginSupportSession(session as SupportSessionStartResult);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading users…</div>;

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name / Email</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id} className="cursor-pointer hover:bg-muted/40">
              <TableCell onClick={() => window.location.assign(`/admin/users/${u.id}`)}>
                <div className="font-medium">{u.full_name || ","}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground" onClick={() => window.location.assign(`/admin/users/${u.id}`)}>
                {new Date(u.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Select
                  value={u.platform_role}
                  onValueChange={(v) =>
                    roleMut.mutate({ user_id: u.id, platform_role: v as "user" | "superadmin" })
                  }
                >
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">user</SelectItem>
                    <SelectItem value="superadmin">superadmin</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell onClick={() => window.location.assign(`/admin/users/${u.id}`)}>
                {u.status === "suspended" ? (
                  <Badge variant="destructive">suspended</Badge>
                ) : (
                  <Badge variant="secondary">active</Badge>
                )}
              </TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/admin/users/$userId" params={{ userId: u.id }}>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    {u.status === "suspended" ? "Reactivate" : "Manage / Suspend"}
                  </Link>
                </Button>
                <Button size="sm" onClick={() => setSupportTarget({ id: u.id, email: u.email })}>
                  Access account
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!supportTarget} onOpenChange={(o) => !o && setSupportTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start support session</DialogTitle>
            <DialogDescription>
              Accessing <strong>{supportTarget?.email}</strong>'s account will be logged with your
              reason and visible in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Customer reported missing meetings (ticket #1234)"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="text-sm font-medium">Write mode</div>
                <div className="text-xs text-muted-foreground">
                  Default is read-only. Only switch on for actions you've agreed to take.
                </div>
              </div>
              <Switch
                checked={mode === "write"}
                onCheckedChange={(c) => setMode(c ? "write" : "read")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupportTarget(null)}>Cancel</Button>
            <Button
              onClick={() => startMut.mutate()}
              disabled={reason.trim().length < 3 || startMut.isPending}
            >
              {mode === "write" ? "Start WRITE session" : "Start read-only session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =================== APP CONTROL ===================
function AppControlPanel() {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <AnnouncementsSection />
      <FlagsSection />
    </div>
  );
}

type AudienceState =
  | { kind: "all" }
  | { kind: "segment"; segment: "free" | "pro" | "team" | "paid" | "trial" }
  | { kind: "users"; user_ids: string[] };

function audienceLabel(a: AudienceState | null | undefined): string {
  if (!a || a.kind === "all") return "All users";
  if (a.kind === "segment") return `Segment: ${a.segment}`;
  return `${a.user_ids.length} user${a.user_ids.length === 1 ? "" : "s"}`;
}

function AudiencePicker({
  value, onChange,
}: { value: AudienceState; onChange: (v: AudienceState) => void }) {
  const seg = value.kind === "segment" ? value.segment : "free";
  return (
    <div className="space-y-2">
      <Label>Audience</Label>
      <Select
        value={value.kind}
        onValueChange={(v) => {
          if (v === "all") onChange({ kind: "all" });
          else if (v === "segment") onChange({ kind: "segment", segment: seg });
          else onChange({ kind: "users", user_ids: [] });
        }}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Everyone</SelectItem>
          <SelectItem value="segment">Plan segment</SelectItem>
          <SelectItem value="users">Specific user IDs</SelectItem>
        </SelectContent>
      </Select>
      {value.kind === "segment" && (
        <Select
          value={value.segment}
          onValueChange={(v) => onChange({ kind: "segment", segment: v as AudienceState extends { kind: "segment"; segment: infer S } ? S : never })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Free (no active plan)</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="paid">Paid (Pro or Team)</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="team">Team</SelectItem>
          </SelectContent>
        </Select>
      )}
      {value.kind === "users" && (
        <Textarea
          rows={3}
          placeholder="One user UUID per line"
          value={value.user_ids.join("\n")}
          onChange={(e) =>
            onChange({
              kind: "users",
              user_ids: e.target.value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      )}
    </div>
  );
}

type AnnouncementDraft = {
  id?: string;
  title: string;
  body: string;
  kind: "info" | "update" | "maintenance" | "feature";
  level: "info" | "warning" | "critical";
  audience: AudienceState;
  active: boolean;
  publish: boolean;
};

function AnnouncementsSection() {
  const listFn = useServerFn(adminListAnnouncements);
  const upsertFn = useServerFn(adminUpsertAnnouncement);
  const deleteFn = useServerFn(adminDeleteAnnouncement);
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => listFn(),
  });
  const [editing, setEditing] = useState<AnnouncementDraft | null>(null);

  const mut = useMutation({
    mutationFn: (v: AnnouncementDraft) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  const now = Date.now();
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold">Announcements</h2>
          <p className="text-xs text-muted-foreground">
            Live for 24 hours on the Today page for the chosen audience.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              title: "", body: "", kind: "info", level: "info",
              audience: { kind: "all" }, active: true, publish: true,
            })
          }
        >
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </div>
      <div className="space-y-2">
        {data.length === 0 && (
          <div className="text-sm text-muted-foreground">No announcements yet.</div>
        )}
        {data.map((a) => {
          const live = a.active && a.published_at && a.expires_at &&
            new Date(a.published_at).getTime() <= now && new Date(a.expires_at).getTime() > now;
          return (
          <div key={a.id} className="flex items-start justify-between gap-3 border rounded p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{a.title}</span>
                <Badge variant={live ? "default" : "outline"}>
                  {live ? "live" : a.expires_at && new Date(a.expires_at).getTime() <= now ? "expired" : "draft"}
                </Badge>
                <Badge variant="secondary">{a.kind ?? "info"}</Badge>
                <Badge variant="outline">{audienceLabel(a.audience as AudienceState)}</Badge>
                {a.source === "flag" && <Badge variant="outline">from flag</Badge>}
              </div>
              {a.body && (
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.body}</div>
              )}
              {a.expires_at && (
                <div className="text-[10px] text-muted-foreground/70 mt-1">
                  Expires {new Date(a.expires_at).toLocaleString()}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setEditing({
                    id: a.id,
                    title: a.title,
                    body: a.body,
                    kind: (a.kind as AnnouncementDraft["kind"]) ?? "info",
                    level: (a.level as AnnouncementDraft["level"]) ?? "info",
                    audience: (a.audience as AudienceState) ?? { kind: "all" },
                    active: a.active,
                    publish: true,
                  })
                }
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => del.mutate(a.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );})}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit announcement" : "New announcement"}</DialogTitle>
            <DialogDescription>
              Publishing sets the 24-hour live window starting now.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div>
                <Label>Message</Label>
                <Textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select
                    value={editing.kind}
                    onValueChange={(v) => setEditing({ ...editing, kind: v as AnnouncementDraft["kind"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="update">Update</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="feature">Feature</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between rounded border p-2">
                  <Label>Active</Label>
                  <Switch
                    checked={editing.active}
                    onCheckedChange={(c) => setEditing({ ...editing, active: c })}
                  />
                </div>
              </div>
              <AudiencePicker
                value={editing.audience}
                onChange={(v) => setEditing({ ...editing, audience: v })}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => editing && mut.mutate(editing)}
              disabled={!editing?.title || mut.isPending}
            >
              {editing?.id ? "Save" : "Publish (24h)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type FlagDraft = {
  id?: string;
  key: string;
  enabled: boolean;
  description: string;
  announce: boolean;
  feature_label: string;
  audience: AudienceState;
};

function FlagsSection() {
  const listFn = useServerFn(adminListFlags);
  const upsertFn = useServerFn(adminUpsertFlag);
  const deleteFn = useServerFn(adminDeleteFlag);
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["admin", "flags"],
    queryFn: () => listFn(),
  });
  const [editing, setEditing] = useState<FlagDraft | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "flags"] });
    qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    qc.invalidateQueries({ queryKey: ["announcements"] });
    qc.invalidateQueries({ queryKey: ["feature-flags"] });
  };

  const mut = useMutation({
    mutationFn: (v: FlagDraft) => upsertFn({ data: v }),
    onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (f: FlagDraft) => upsertFn({ data: f }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold">Feature flags</h2>
          <p className="text-xs text-muted-foreground">
            Optionally drop a 24h "New feature" card on Today when you turn one on.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setEditing({
            key: "", enabled: false, description: "",
            announce: false, feature_label: "",
            audience: { kind: "all" },
          })}
        >
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </div>
      <div className="space-y-2">
        {data.length === 0 && (
          <div className="text-sm text-muted-foreground">No flags defined.</div>
        )}
        {data.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 border rounded p-3">
            <div className="min-w-0">
              <div className="font-mono text-sm">{f.key}</div>
              {f.description && (
                <div className="text-xs text-muted-foreground">{f.description}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={f.enabled}
                onCheckedChange={(c) =>
                  toggle.mutate({
                    id: f.id, key: f.key, enabled: c, description: f.description,
                    announce: false, feature_label: "", audience: { kind: "all" },
                  })
                }
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setEditing({
                    id: f.id, key: f.key, enabled: f.enabled, description: f.description,
                    announce: false, feature_label: f.key, audience: { kind: "all" },
                  })
                }
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => del.mutate(f.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit flag" : "New flag"}</DialogTitle>
            <DialogDescription>
              Lowercase letters, numbers, dots, dashes, underscores only.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Key</Label>
                <Input
                  value={editing.key}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                  placeholder="e.g. new_weekly_report"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between rounded border p-2">
                <Label>Enabled</Label>
                <Switch
                  checked={editing.enabled}
                  onCheckedChange={(c) => setEditing({ ...editing, enabled: c })}
                />
              </div>
              <div className="rounded border p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Announce on Today</Label>
                    <p className="text-xs text-muted-foreground">
                      When enabling, post a 24h "New: &lt;feature&gt; is now available" card.
                    </p>
                  </div>
                  <Switch
                    checked={editing.announce}
                    onCheckedChange={(c) => setEditing({ ...editing, announce: c })}
                  />
                </div>
                {editing.announce && (
                  <>
                    <div>
                      <Label>Feature label</Label>
                      <Input
                        value={editing.feature_label}
                        onChange={(e) => setEditing({ ...editing, feature_label: e.target.value })}
                        placeholder="Defaults to the flag key"
                      />
                    </div>
                    <AudiencePicker
                      value={editing.audience}
                      onChange={(v) => setEditing({ ...editing, audience: v })}
                    />
                  </>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => editing && mut.mutate(editing)}
              disabled={!editing?.key || mut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =================== AUDIT ===================
function AuditPanel() {
  const listFn = useServerFn(adminListAccessLog);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => listFn(),
  });
  const { data: active } = useActiveSupportSession();

  return (
    <div className="space-y-4">
      {active && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You currently have an active support session on{" "}
          <strong>{active.target_email}</strong> ({active.mode}). Use the banner at the top of the
          app to switch modes or end it.
        </div>
      )}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Ended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No support sessions yet.</TableCell></TableRow>
            ) : (
              data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.started_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.admin_email}</TableCell>
                  <TableCell className="text-xs">{r.target_email}</TableCell>
                  <TableCell>
                    {r.mode === "write" ? (
                      <Badge variant="destructive" className="gap-1"><Edit3 className="h-3 w-3" /> write</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" /> read</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-xs truncate" title={r.reason}>{r.reason}</TableCell>
                  <TableCell className="text-xs">
                    {r.ended_at ? new Date(r.ended_at).toLocaleString() : <Badge>active</Badge>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
