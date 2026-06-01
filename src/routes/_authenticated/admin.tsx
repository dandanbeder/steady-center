import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldAlert, Plus, Trash2, Eye, Edit3 } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { useActiveSupportSession } from "@/hooks/use-support-session";
import {
  adminListUsers,
  adminSetUserStatus,
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

export const Route = createFileRoute("/_authenticated/admin")({
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
          <TabsTrigger value="control">App Control</TabsTrigger>
          <TabsTrigger value="audit">Support Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-6"><UsersPanel /></TabsContent>
        <TabsContent value="control" className="mt-6"><AppControlPanel /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// =================== USERS ===================
function UsersPanel() {
  const listFn = useServerFn(adminListUsers);
  const statusFn = useServerFn(adminSetUserStatus);
  const roleFn = useServerFn(adminSetPlatformRole);
  const startFn = useServerFn(adminStartSupportSession);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listFn(),
  });

  const statusMut = useMutation({
    mutationFn: (v: { user_id: string; status: "active" | "suspended" }) => statusFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); toast.success("Updated"); },
    onError: (e: Error) => toast.error(e.message),
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
    mutationFn: () => startFn({ data: { target_user_id: supportTarget!.id, reason, mode } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Support session started");
      setSupportTarget(null);
      setReason("");
      setMode("read");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading users…</div>;

  return (
    <div className="border rounded-lg">
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
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.full_name || "—"}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
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
              <TableCell>
                {u.status === "suspended" ? (
                  <Badge variant="destructive">suspended</Badge>
                ) : (
                  <Badge variant="secondary">active</Badge>
                )}
              </TableCell>
              <TableCell className="text-right space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    statusMut.mutate({
                      user_id: u.id,
                      status: u.status === "suspended" ? "active" : "suspended",
                    })
                  }
                >
                  {u.status === "suspended" ? "Reactivate" : "Suspend"}
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

function AnnouncementsSection() {
  const listFn = useServerFn(adminListAnnouncements);
  const upsertFn = useServerFn(adminUpsertAnnouncement);
  const deleteFn = useServerFn(adminDeleteAnnouncement);
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => listFn(),
  });
  const [editing, setEditing] = useState<
    | null
    | { id?: string; title: string; body: string; level: "info" | "warning" | "critical"; active: boolean }
  >(null);

  const mut = useMutation({
    mutationFn: (v: NonNullable<typeof editing>) => upsertFn({ data: v }),
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

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Announcements</h2>
        <Button
          size="sm"
          onClick={() => setEditing({ title: "", body: "", level: "info", active: true })}
        >
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </div>
      <div className="space-y-2">
        {data.length === 0 && (
          <div className="text-sm text-muted-foreground">No announcements yet.</div>
        )}
        {data.map((a) => (
          <div
            key={a.id}
            className="flex items-start justify-between gap-3 border rounded p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.title}</span>
                <Badge variant={a.active ? "default" : "outline"}>
                  {a.active ? "active" : "inactive"}
                </Badge>
                <Badge variant="secondary">{a.level}</Badge>
              </div>
              {a.body && (
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.body}</div>
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
                    level: a.level as "info" | "warning" | "critical",
                    active: a.active,
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
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit announcement" : "New announcement"}</DialogTitle>
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
                <Label>Body</Label>
                <Textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Level</Label>
                  <Select
                    value={editing.level}
                    onValueChange={(v) =>
                      setEditing({ ...editing, level: v as "info" | "warning" | "critical" })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
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
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => editing && mut.mutate(editing)}
              disabled={!editing?.title || mut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FlagsSection() {
  const listFn = useServerFn(adminListFlags);
  const upsertFn = useServerFn(adminUpsertFlag);
  const deleteFn = useServerFn(adminDeleteFlag);
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["admin", "flags"],
    queryFn: () => listFn(),
  });
  const [editing, setEditing] = useState<
    null | { id?: string; key: string; enabled: boolean; description: string }
  >(null);

  const mut = useMutation({
    mutationFn: (v: NonNullable<typeof editing>) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "flags"] });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (f: { id: string; key: string; enabled: boolean; description: string }) =>
      upsertFn({ data: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "flags"] });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "flags"] });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Feature flags</h2>
        <Button
          size="sm"
          onClick={() => setEditing({ key: "", enabled: false, description: "" })}
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
                    id: f.id,
                    key: f.key,
                    enabled: c,
                    description: f.description,
                  })
                }
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setEditing({
                    id: f.id,
                    key: f.key,
                    enabled: f.enabled,
                    description: f.description,
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
      <div className="border rounded-lg">
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
