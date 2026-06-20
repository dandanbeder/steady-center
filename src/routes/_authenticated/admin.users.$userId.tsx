import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft,
  Mail,
  ShieldAlert,
  KeyRound,
  Ban,
  CreditCard,
  Sliders,
  UserCog,
  Trash2,
  CheckCircle2,
  Plus,
  Activity,
  Users,
  Eye,
  StickyNote,
  Flag,
  Gauge,
  Pin,
  PinOff,
} from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { useAuth } from "@/hooks/use-auth";
import {
  adminGetUser,
  adminUpdateProfile,
  adminChangeUserEmail,
  adminResendVerification,
  adminManuallyVerifyEmail,
  adminSendPasswordReset,
  adminRevokeSessions,
  adminSetTempPassword,
  adminSuspendUser,
  adminReactivateUser,
  adminSetPlatformRole,
  adminUpsertEntitlementOverride,
  adminDeleteEntitlementOverride,
  adminCompSubscription,
  adminExtendTrial,
  adminAdjustSeats,
  adminScheduleUserDeletion,
  adminCancelUserDeletion,
  adminStartSupportSession,
} from "@/lib/admin.functions";
import {
  adminGetCustomer360,
  adminAddCustomerNote,
  adminUpdateCustomerNote,
  adminDeleteCustomerNote,
  adminSetUserFeatureFlag,
  adminClearUserFeatureFlag,
} from "@/lib/customer360.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { beginSupportSession, type SupportSessionStartResult } from "@/lib/support-session";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReasonConfirmDialog } from "@/components/admin/reason-confirm-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/users/$userId")({
  component: UserDetailPage,
});

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <h2 className="flex items-center gap-2 font-semibold text-base">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h2>
      {children}
    </section>
  );
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const { isAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetUser);
  const detailQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => getFn({ data: { user_id: userId } }),
    enabled: !!isAdmin,
  });

  if (adminLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;
  if (detailQ.isLoading) return <div className="p-8 text-muted-foreground">Loading user…</div>;
  if (detailQ.error || !detailQ.data) return <div className="p-8 text-destructive">{(detailQ.error as Error)?.message ?? "Not found"}</div>;

  const data = detailQ.data;
  const isSelf = me?.id === userId;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "customer360", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{data.profile?.full_name || data.auth.email}</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{data.auth.email}</span>
            {data.profile?.status === "suspended" && <Badge variant="destructive">suspended</Badge>}
            {data.profile?.platform_role === "superadmin" && <Badge>superadmin</Badge>}
            {data.profile?.deletion_scheduled_at && (
              <Badge variant="destructive">deletion {new Date(data.profile.deletion_scheduled_at).toLocaleDateString()}</Badge>
            )}
            {isSelf && <Badge variant="outline">you</Badge>}
          </div>
        </div>
        <ViewAsButton targetUserId={userId} />
      </div>

      <Customer360Sections userId={userId} onDone={invalidate} />

      <ProfileSection data={data} userId={userId} onDone={invalidate} />
      <EmailSection data={data} userId={userId} onDone={invalidate} />
      <PasswordSection userId={userId} onDone={invalidate} />
      <StatusSection data={data} userId={userId} isSelf={isSelf} onDone={invalidate} />
      <PlanSection data={data} userId={userId} onDone={invalidate} />
      <OverridesSection data={data} userId={userId} onDone={invalidate} />
      <RoleSection data={data} userId={userId} isSelf={isSelf} onDone={invalidate} />
      <DangerSection data={data} userId={userId} isSelf={isSelf} email={data.auth.email} onDone={() => { invalidate(); navigate({ to: "/admin" }); }} />
      <AuditSection data={data} />
    </div>
  );
}

// ---------- Sections ----------

function ProfileSection({ data, userId, onDone }: { data: any; userId: string; onDone: () => void }) {
  const fn = useServerFn(adminUpdateProfile);
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState({
    full_name: data.profile?.full_name ?? "",
    organisation: data.profile?.organisation ?? "",
    role_title: data.profile?.role_title ?? "",
    phone: data.profile?.phone ?? "",
    timezone: data.profile?.timezone ?? "",
  });
  const mut = useMutation({
    mutationFn: (reason: string) => fn({ data: { user_id: userId, reason, patch } }),
    onSuccess: () => { toast.success("Profile updated"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={UserCog} title="Profile">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><Input value={patch.full_name} onChange={(e) => setPatch({ ...patch, full_name: e.target.value })} /></Field>
        <Field label="Organisation"><Input value={patch.organisation} onChange={(e) => setPatch({ ...patch, organisation: e.target.value })} /></Field>
        <Field label="Role"><Input value={patch.role_title} onChange={(e) => setPatch({ ...patch, role_title: e.target.value })} /></Field>
        <Field label="Phone"><Input value={patch.phone} onChange={(e) => setPatch({ ...patch, phone: e.target.value })} /></Field>
        <Field label="Timezone"><Input value={patch.timezone} onChange={(e) => setPatch({ ...patch, timezone: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>Save changes</Button>
      </div>
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Save profile changes?"
        description="A short reason is logged in the audit trail."
        confirmLabel="Save"
        pending={mut.isPending}
        onConfirm={(r) => mut.mutate(r)}
      />
    </Section>
  );
}

function EmailSection({ data, userId, onDone }: { data: any; userId: string; onDone: () => void }) {
  const changeFn = useServerFn(adminChangeUserEmail);
  const resendFn = useServerFn(adminResendVerification);
  const verifyFn = useServerFn(adminManuallyVerifyEmail);
  const [newEmail, setNewEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const changeMut = useMutation({
    mutationFn: (reason: string) => changeFn({ data: { user_id: userId, new_email: newEmail, reason } }),
    onSuccess: () => { toast.success("Email changed, notices sent"); setOpen(false); setNewEmail(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resendMut = useMutation({
    mutationFn: () => resendFn({ data: { user_id: userId } }),
    onSuccess: () => toast.success("Verification email sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  const verifyMut = useMutation({
    mutationFn: (reason: string) => verifyFn({ data: { user_id: userId, reason } }),
    onSuccess: () => { toast.success("Email marked verified"); setVerifyOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={Mail} title="Email">
      <div className="text-sm text-muted-foreground">
        Current: <span className="text-foreground font-medium">{data.auth.email}</span>{" "}
        {data.auth.email_confirmed_at ? (
          <Badge variant="outline" className="ml-2">verified</Badge>
        ) : (
          <Badge variant="secondary" className="ml-2">unverified</Badge>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input placeholder="new@email.com" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Button onClick={() => setOpen(true)} disabled={!newEmail || newEmail === data.auth.email}>Change email…</Button>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => resendMut.mutate()} disabled={resendMut.isPending}>Resend verification</Button>
        <Button variant="outline" size="sm" onClick={() => setVerifyOpen(true)}>Manually verify email</Button>
      </div>
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Change user's email?"
        description={<span>Updates auth email and notifies <strong>{data.auth.email}</strong> and <strong>{newEmail}</strong>.</span>}
        confirmToken={newEmail}
        confirmTokenLabel="Re-type the new email"
        confirmLabel="Change email"
        destructive
        pending={changeMut.isPending}
        onConfirm={(r) => changeMut.mutate(r)}
      />
      <ReasonConfirmDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        title="Manually verify email?"
        confirmLabel="Verify"
        pending={verifyMut.isPending}
        onConfirm={(r) => verifyMut.mutate(r)}
      />
    </Section>
  );
}

function PasswordSection({ userId, onDone }: { userId: string; onDone: () => void }) {
  const resetFn = useServerFn(adminSendPasswordReset);
  const revokeFn = useServerFn(adminRevokeSessions);
  const tempFn = useServerFn(adminSetTempPassword);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const resetMut = useMutation({
    mutationFn: () => resetFn({ data: { user_id: userId } }),
    onSuccess: () => toast.success("Password reset link sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: (reason: string) => revokeFn({ data: { user_id: userId, reason } }),
    onSuccess: () => { toast.success("All sessions revoked"); setRevokeOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const tempMut = useMutation({
    mutationFn: (reason: string) => tempFn({ data: { user_id: userId, reason } }),
    onSuccess: () => { toast.success("Temp password set; user emailed and signed out"); setTempOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={KeyRound} title="Password & sessions">
      <p className="text-sm text-muted-foreground">
        Admins can never view a user's existing password. Send a reset link, set a temporary password
        that forces a change at next login, or sign them out everywhere.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>Send password reset link</Button>
        <Button variant="outline" onClick={() => setTempOpen(true)}>Set temporary password…</Button>
        <Button variant="outline" onClick={() => setRevokeOpen(true)}>Revoke all sessions</Button>
      </div>
      <ReasonConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke every session?"
        description="The user will be signed out on all devices immediately."
        confirmLabel="Revoke sessions"
        destructive
        pending={revokeMut.isPending}
        onConfirm={(r) => revokeMut.mutate(r)}
      />
      <ReasonConfirmDialog
        open={tempOpen}
        onOpenChange={setTempOpen}
        title="Set a temporary password?"
        description="A random temp password is emailed to the user, all sessions are revoked, and they're forced to choose a new password on next login."
        confirmLabel="Set temp password"
        destructive
        pending={tempMut.isPending}
        onConfirm={(r) => tempMut.mutate(r)}
      />
    </Section>
  );
}

function StatusSection({ data, userId, isSelf, onDone }: { data: any; userId: string; isSelf: boolean; onDone: () => void }) {
  const suspendFn = useServerFn(adminSuspendUser);
  const reactivateFn = useServerFn(adminReactivateUser);
  const isSuspended = data.profile?.status === "suspended";
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [message, setMessage] = useState(data.profile?.suspended_message ?? "");
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const suspendMut = useMutation({
    mutationFn: (reason: string) => suspendFn({ data: { user_id: userId, reason, message: message || undefined } }),
    onSuccess: () => { toast.success("User suspended"); setSuspendOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reactivateMut = useMutation({
    mutationFn: (reason: string) => reactivateFn({ data: { user_id: userId, reason } }),
    onSuccess: () => { toast.success("User reactivated"); setReactivateOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={Ban} title="Status">
      {isSuspended ? (
        <>
          <div className="text-sm">Status: <Badge variant="destructive">suspended</Badge></div>
          {data.profile?.suspended_reason && (
            <div className="text-sm"><span className="text-muted-foreground">Reason: </span>{data.profile.suspended_reason}</div>
          )}
          {data.profile?.suspended_message && (
            <div className="text-sm"><span className="text-muted-foreground">User sees: </span>“{data.profile.suspended_message}”</div>
          )}
          <Button onClick={() => setReactivateOpen(true)}><CheckCircle2 className="h-4 w-4 mr-1" /> Reactivate</Button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Message shown on user's login (optional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Your account is suspended — contact support."
              rows={2}
            />
          </div>
          <Button variant="destructive" onClick={() => setSuspendOpen(true)} disabled={isSelf}>
            Suspend account
          </Button>
          {isSelf && <p className="text-xs text-muted-foreground">You cannot suspend your own account.</p>}
        </>
      )}
      <ReasonConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title="Suspend this user?"
        description="They cannot sign in or hit the API until you reactivate them. Their data is untouched."
        destructive
        confirmLabel="Suspend"
        pending={suspendMut.isPending}
        onConfirm={(r) => suspendMut.mutate(r)}
      />
      <ReasonConfirmDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title="Reactivate this user?"
        confirmLabel="Reactivate"
        pending={reactivateMut.isPending}
        onConfirm={(r) => reactivateMut.mutate(r)}
      />
    </Section>
  );
}

function PlanSection({ data, userId, onDone }: { data: any; userId: string; onDone: () => void }) {
  const compFn = useServerFn(adminCompSubscription);
  const trialFn = useServerFn(adminExtendTrial);
  const seatsFn = useServerFn(adminAdjustSeats);
  const [compOpen, setCompOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [plan, setPlan] = useState<"pro_plan" | "team_plan">("pro_plan");
  const [months, setMonths] = useState(1);
  const [days, setDays] = useState(14);
  const currentSeats = (data.overrides ?? []).find((o: any) => o.key === "team_seats")?.value ?? 0;
  const [seats, setSeats] = useState<number>(currentSeats);
  const compMut = useMutation({
    mutationFn: (reason: string) => compFn({ data: { user_id: userId, plan, months, reason } }),
    onSuccess: () => { toast.success("Subscription comped"); setCompOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const trialMut = useMutation({
    mutationFn: (reason: string) => trialFn({ data: { user_id: userId, days, reason } }),
    onSuccess: () => { toast.success("Trial extended"); setTrialOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const seatsMut = useMutation({
    mutationFn: (reason: string) => seatsFn({ data: { user_id: userId, seats, reason } }),
    onSuccess: () => { toast.success("Seats updated"); setSeatsOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sub = data.subscription;
  return (
    <Section icon={CreditCard} title="Plan & billing">
      {sub ? (
        <div className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Plan: </span>{sub.product_id} <Badge variant="outline" className="ml-2">{sub.status}</Badge> <Badge variant="secondary" className="ml-1">{sub.environment}</Badge></div>
          <div><span className="text-muted-foreground">Renews/ends: </span>{sub.current_period_end ? new Date(sub.current_period_end).toLocaleString() : "—"}</div>
          <div><span className="text-muted-foreground">Paddle customer: </span><code className="text-xs">{sub.paddle_customer_id}</code></div>
          {sub.paddle_customer_id && sub.paddle_customer_id !== "comp" && sub.paddle_customer_id !== "trial" && (
            <a
              className="text-xs text-accent hover:underline"
              href={`https://vendors.paddle.com/customers-v2/${encodeURIComponent(sub.paddle_customer_id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Paddle ↗
            </a>
          )}
          <div><span className="text-muted-foreground">Seats override: </span><strong>{currentSeats || "—"}</strong></div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No subscription on record (Free).</p>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="outline" onClick={() => setCompOpen(true)}>Comp a plan…</Button>
        <Button variant="outline" onClick={() => setTrialOpen(true)}>Extend trial…</Button>
        <Button variant="outline" onClick={() => { setSeats(currentSeats); setSeatsOpen(true); }}>Adjust seats…</Button>
      </div>
      <ReasonConfirmDialog
        open={compOpen}
        onOpenChange={setCompOpen}
        title="Comp a plan"
        confirmLabel="Comp"
        pending={compMut.isPending}
        onConfirm={(r) => compMut.mutate(r)}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as "pro_plan" | "team_plan")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pro_plan">Pro</SelectItem>
                <SelectItem value="team_plan">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Months</Label>
            <Input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(parseInt(e.target.value || "1", 10))} />
          </div>
        </div>
      </ReasonConfirmDialog>
      <ReasonConfirmDialog
        open={trialOpen}
        onOpenChange={setTrialOpen}
        title="Extend trial"
        confirmLabel="Extend"
        pending={trialMut.isPending}
        onConfirm={(r) => trialMut.mutate(r)}
      >
        <div className="space-y-1">
          <Label>Days to add</Label>
          <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(parseInt(e.target.value || "7", 10))} />
        </div>
      </ReasonConfirmDialog>
      <ReasonConfirmDialog
        open={seatsOpen}
        onOpenChange={setSeatsOpen}
        title="Adjust seats"
        confirmLabel="Save seats"
        pending={seatsMut.isPending}
        onConfirm={(r) => seatsMut.mutate(r)}
      >
        <div className="space-y-1">
          <Label>Seats (0 to clear override)</Label>
          <Input type="number" min={0} max={10000} value={seats} onChange={(e) => setSeats(parseInt(e.target.value || "0", 10))} />
        </div>
      </ReasonConfirmDialog>
    </Section>
  );
}

function OverridesSection({ data, userId, onDone }: { data: any; userId: string; onDone: () => void }) {
  const upFn = useServerFn(adminUpsertEntitlementOverride);
  const delFn = useServerFn(adminDeleteEntitlementOverride);
  const [adding, setAdding] = useState(false);
  const [k, setK] = useState("ai_actions_extra");
  const [v, setV] = useState(100);
  const [exp, setExp] = useState("");
  const [note, setNote] = useState("");
  const addMut = useMutation({
    mutationFn: () => upFn({ data: { user_id: userId, key: k, value: v, expires_at: exp ? new Date(exp).toISOString() : null, note } }),
    onSuccess: () => { toast.success("Override added"); setAdding(false); setNote(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Override removed"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={Sliders} title="Limit overrides">
      {(data.overrides?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No overrides.</p>
      ) : (
        <div className="space-y-2">
          {data.overrides.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between gap-3 border rounded p-3 text-sm">
              <div>
                <div><code className="text-xs">{o.key}</code> <strong>+{o.value}</strong></div>
                <div className="text-xs text-muted-foreground">
                  {o.expires_at ? `expires ${new Date(o.expires_at).toLocaleDateString()}` : "no expiry"}
                  {o.note ? ` · ${o.note}` : ""}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => delMut.mutate(o.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded p-3">
          <Field label="Key"><Input value={k} onChange={(e) => setK(e.target.value)} placeholder="ai_actions_extra" /></Field>
          <Field label="Value"><Input type="number" value={v} onChange={(e) => setV(parseInt(e.target.value || "0", 10))} /></Field>
          <Field label="Expires (optional)"><Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>Add override</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" /> New override</Button>
      )}
    </Section>
  );
}

function RoleSection({ data, userId, isSelf, onDone }: { data: any; userId: string; isSelf: boolean; onDone: () => void }) {
  const fn = useServerFn(adminSetPlatformRole);
  const [open, setOpen] = useState(false);
  const current = data.profile?.platform_role as "user" | "superadmin";
  const target: "user" | "superadmin" = current === "superadmin" ? "user" : "superadmin";
  const mut = useMutation({
    mutationFn: (reason: string) => fn({ data: { user_id: userId, platform_role: target, reason } }),
    onSuccess: () => { toast.success("Role updated"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={ShieldAlert} title="Platform role">
      <div className="text-sm">Current: <Badge>{current}</Badge></div>
      <Button
        variant={target === "user" ? "destructive" : "default"}
        onClick={() => setOpen(true)}
        disabled={isSelf && target === "user"}
      >
        {target === "superadmin" ? "Promote to superadmin" : "Demote to user"}
      </Button>
      {isSelf && target === "user" && <p className="text-xs text-muted-foreground">You cannot demote your own account.</p>}
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={target === "superadmin" ? "Promote to superadmin?" : "Demote to user?"}
        confirmLabel={target === "superadmin" ? "Promote" : "Demote"}
        destructive={target === "user"}
        pending={mut.isPending}
        onConfirm={(r) => mut.mutate(r)}
      />
    </Section>
  );
}

function DangerSection({ data, userId, isSelf, email, onDone }: { data: any; userId: string; isSelf: boolean; email: string; onDone: () => void }) {
  const scheduleFn = useServerFn(adminScheduleUserDeletion);
  const cancelFn = useServerFn(adminCancelUserDeletion);
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const scheduled = !!data.profile?.deletion_scheduled_at;
  const scheduleMut = useMutation({
    mutationFn: (reason: string) => scheduleFn({ data: { user_id: userId, typed_email: email, reason } }),
    onSuccess: () => { toast.success("Deletion scheduled (7-day window)"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: (reason: string) => cancelFn({ data: { user_id: userId, reason } }),
    onSuccess: () => { toast.success("Deletion cancelled"); setCancelOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={Trash2} title="Danger zone">
      {scheduled ? (
        <>
          <p className="text-sm">
            Scheduled for permanent deletion on{" "}
            <strong>{new Date(data.profile.deletion_scheduled_at).toLocaleString()}</strong>.
            The user is suspended in the meantime.
          </p>
          <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancel deletion</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Schedules a 7-day soft delete. The account is suspended immediately, and all data is purged
            after the window unless cancelled.
          </p>
          <Button variant="destructive" onClick={() => setOpen(true)} disabled={isSelf}>
            Delete user and all data…
          </Button>
          {isSelf && <p className="text-xs text-muted-foreground">You cannot delete your own account.</p>}
        </>
      )}
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete user and all data?"
        description={<span>This schedules permanent deletion in 7 days and immediately suspends the account. Type <strong>{email}</strong> to confirm.</span>}
        confirmToken={email}
        confirmTokenLabel="Type the user's email"
        confirmLabel="Schedule deletion"
        destructive
        pending={scheduleMut.isPending}
        onConfirm={(r) => scheduleMut.mutate(r)}
      />
      <ReasonConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel scheduled deletion?"
        confirmLabel="Cancel deletion"
        pending={cancelMut.isPending}
        onConfirm={(r) => cancelMut.mutate(r)}
      />
    </Section>
  );
}

function AuditSection({ data }: { data: any }) {
  return (
    <Section icon={ShieldAlert} title="Audit log (last 100)">
      {(data.audit?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No entries yet.</p>
      ) : (
        <div className="space-y-1 text-sm">
          {data.audit.map((a: any) => (
            <div key={a.id} className="border rounded p-2">
              <div className="flex items-center justify-between">
                <code className="text-xs">{a.action}</code>
                <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              {a.reason && <div className="text-xs text-muted-foreground">{a.reason}</div>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ============================================================
// Customer 360 — additional sections
// ============================================================

function ViewAsButton({ targetUserId }: { targetUserId: string }) {
  const startFn = useServerFn(adminStartSupportSession);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const mut = useMutation({
    mutationFn: (reason: string) =>
      startFn({
        data: { target_user_id: targetUserId, reason, mode: "read", redirect_origin: window.location.origin },
      }),
    onSuccess: (session) => {
      toast.success("Support session started (read-only)");
      qc.invalidateQueries({ queryKey: ["admin"] });
      setOpen(false);
      beginSupportSession(session as SupportSessionStartResult);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4 mr-1" /> View as user
      </Button>
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Start read-only support session?"
        description="Opens this user's account in read-only mode. You can switch to write later from the banner. All actions are logged."
        confirmLabel="Start session"
        pending={mut.isPending}
        onConfirm={(r) => mut.mutate(r)}
      />
    </>
  );
}

function Customer360Sections({ userId, onDone }: { userId: string; onDone: () => void }) {
  const fn = useServerFn(adminGetCustomer360);
  const q = useQuery({
    queryKey: ["admin", "customer360", userId],
    queryFn: () => fn({ data: { user_id: userId } }),
  });
  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading customer view…</div>;
  if (!q.data) return null;
  const c = q.data;
  return (
    <>
      <UsageSection c={c} />
      <SharingSection c={c} />
      <SupportHistorySection c={c} />
      <NotesSection targetUserId={userId} notes={c.notes} onDone={onDone} />
      <FeatureFlagsSection userId={userId} flags={c.feature_flags} onDone={onDone} />
    </>
  );
}

function UsageSection({ c }: { c: any }) {
  const aiPct =
    c.usage.ai_actions_cap > 0
      ? Math.min(100, Math.round((c.usage.ai_actions_used / c.usage.ai_actions_cap) * 100))
      : 0;
  return (
    <Section icon={Gauge} title="Usage & activity">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="AI actions (this month)" value={`${c.usage.ai_actions_used} / ${c.usage.ai_actions_cap}`} sub={`${aiPct}% used`} />
        <Stat label="AI spend (this month)" value={`$${(c.usage.ai_cents / 100).toFixed(2)}`} />
        <Stat label="Accounts owned" value={c.usage.accounts_owned} />
        <Stat label="Real connections" value={c.usage.connections_count} sub={`${c.usage.calendars.length} calendars`} />
      </div>
      {c.usage.ai_history.length > 0 && (
        <div className="text-xs text-muted-foreground">
          History:{" "}
          {c.usage.ai_history.map((h: any) => `${h.month}: ${h.actions}`).join(" · ")}
        </div>
      )}
      <div>
        <div className="text-sm font-medium mb-1 flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Recent activity (30d)</div>
        {c.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded events.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            {c.activity.slice(0, 30).map((a: any) => (
              <div key={a.id} className="text-xs flex items-center justify-between border-b pb-1">
                <span><code>{a.type}</code>{a.account_name ? ` · ${a.account_name}` : ""}</span>
                <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function SharingSection({ c }: { c: any }) {
  return (
    <Section icon={Users} title="Team & sharing">
      <div>
        <div className="text-sm font-medium mb-1">Memberships ({c.usage.memberships.length})</div>
        {c.usage.memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team memberships.</p>
        ) : (
          <div className="space-y-1">
            {c.usage.memberships.map((m: any) => (
              <div key={m.id} className="text-sm flex items-center justify-between border rounded p-2">
                <span>{m.business_name}</span>
                <span className="flex items-center gap-1">
                  <Badge variant="outline">{m.role}</Badge>
                  <Badge variant={m.status === "active" ? "secondary" : "outline"}>{m.status}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-sm font-medium mb-1">Shared by user ({c.sharing.granted.length})</div>
          {c.sharing.granted.length === 0 ? (
            <p className="text-xs text-muted-foreground">None.</p>
          ) : (
            <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {c.sharing.granted.slice(0, 50).map((s: any) => (
                <div key={s.id}>{s.resource_type} → {s.grantee_email || s.grantee_user_id.slice(0, 8)} ({s.role})</div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-medium mb-1">Shared with user ({c.sharing.received.length})</div>
          {c.sharing.received.length === 0 ? (
            <p className="text-xs text-muted-foreground">None.</p>
          ) : (
            <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {c.sharing.received.slice(0, 50).map((s: any) => (
                <div key={s.id}>{s.resource_type} from {s.granter_email || (s.granted_by ?? "—").slice(0, 8)} ({s.role})</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function SupportHistorySection({ c }: { c: any }) {
  return (
    <Section icon={Eye} title="Support history">
      <div>
        <div className="text-sm font-medium mb-1">View-as sessions ({c.support.sessions.length})</div>
        {c.support.sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {c.support.sessions.map((s: any) => (
              <div key={s.id} className="text-xs border rounded p-2">
                <div className="flex items-center justify-between">
                  <span><Badge variant={s.mode === "write" ? "destructive" : "outline"}>{s.mode}</Badge> {s.admin_email}</span>
                  <span className="text-muted-foreground">
                    {new Date(s.started_at).toLocaleString()}{s.ended_at ? ` → ${new Date(s.ended_at).toLocaleTimeString()}` : " (active)"}
                  </span>
                </div>
                {s.reason && <div className="text-muted-foreground mt-1">{s.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="text-sm font-medium mb-1">Admin actions ({c.support.actions.length})</div>
        {c.support.actions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {c.support.actions.map((a: any) => (
              <div key={a.id} className="text-xs border rounded p-2">
                <div className="flex items-center justify-between">
                  <span><code>{a.action}</code> · {a.admin_email}</span>
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                {a.reason && <div className="text-muted-foreground mt-1">{a.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function NotesSection({
  targetUserId,
  notes,
  onDone,
}: {
  targetUserId: string;
  notes: any[];
  onDone: () => void;
}) {
  const addFn = useServerFn(adminAddCustomerNote);
  const updFn = useServerFn(adminUpdateCustomerNote);
  const delFn = useServerFn(adminDeleteCustomerNote);
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const addMut = useMutation({
    mutationFn: () => addFn({ data: { target_user_id: targetUserId, body, pinned } }),
    onSuccess: () => { toast.success("Note added"); setBody(""); setPinned(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pinMut = useMutation({
    mutationFn: (n: any) => updFn({ data: { id: n.id, pinned: !n.pinned } }),
    onSuccess: () => onDone(),
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Note removed"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={StickyNote} title="Internal admin notes">
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add an internal note about this customer (not visible to them)…"
          rows={3}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={pinned} onCheckedChange={setPinned} /> Pin
          </label>
          <Button onClick={() => addMut.mutate()} disabled={!body.trim() || addMut.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Add note
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className={`border rounded p-3 text-sm ${n.pinned ? "bg-accent/30" : ""}`}>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{n.author_email || "admin"} · {new Date(n.created_at).toLocaleString()}</span>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => pinMut.mutate(n)} title={n.pinned ? "Unpin" : "Pin"}>
                    {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => delMut.mutate(n.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="whitespace-pre-wrap">{n.body}</div>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

function FeatureFlagsSection({
  userId,
  flags,
  onDone,
}: {
  userId: string;
  flags: any[];
  onDone: () => void;
}) {
  const setFn = useServerFn(adminSetUserFeatureFlag);
  const clearFn = useServerFn(adminClearUserFeatureFlag);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [expires, setExpires] = useState("");
  const setMut = useMutation({
    mutationFn: (reason: string) =>
      setFn({
        data: {
          user_id: userId,
          flag_key: key,
          enabled,
          expires_at: expires ? new Date(expires).toISOString() : null,
          reason,
        },
      }),
    onSuccess: () => { toast.success("Flag override saved"); setOpen(false); setKey(""); setExpires(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clearMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      clearFn({ data: { id, reason } }),
    onSuccess: () => { toast.success("Flag cleared"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section icon={Flag} title="Per-user feature flags">
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No per-user flag overrides.</p>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.id} className="border rounded p-3 text-sm flex items-center justify-between">
              <div>
                <div><code className="text-xs">{f.flag_key}</code> <Badge variant={f.enabled ? "default" : "outline"}>{f.enabled ? "on" : "off"}</Badge></div>
                <div className="text-xs text-muted-foreground">
                  {f.expires_at ? `expires ${new Date(f.expires_at).toLocaleString()}` : "no expiry"}
                  {f.reason ? ` · ${f.reason}` : ""}
                  {f.created_by_email ? ` · by ${f.created_by_email}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  clearMut.mutate({ id: f.id, reason: "cleared via Customer 360" })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Flag key">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="beta_meetings_v2" />
        </Field>
        <Field label="State">
          <Select value={enabled ? "on" : "off"} onValueChange={(v) => setEnabled(v === "on")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="on">Enabled</SelectItem>
              <SelectItem value="off">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Expires (optional)">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button disabled={!key.trim()} onClick={() => setOpen(true)}>Save override</Button>
      </div>
      <ReasonConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Set per-user feature flag?"
        description="This overrides the global flag setting for this user only."
        confirmLabel="Save"
        pending={setMut.isPending}
        onConfirm={(r) => setMut.mutate(r)}
      />
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
