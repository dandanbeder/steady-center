import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mail, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { listMembers, removeMember, updateMemberRole } from "@/lib/memberships.functions";
import {
  decideAccessRequest,
  inviteByEmail,
  listInvitations,
  listPendingRequests,
  resendInvitation,
  revokeInvitation,
} from "@/lib/invitations.functions";
import { useMyRole, type Role } from "@/hooks/use-my-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ASSIGNABLE: Role[] = ["admin", "member", "commenter", "viewer"];

export function PeoplePanel({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const my = useMyRole(businessId);
  const list = useServerFn(listMembers);
  const invite = useServerFn(inviteByEmail);
  const updateRole = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const listInv = useServerFn(listInvitations);
  const resend = useServerFn(resendInvitation);
  const revoke = useServerFn(revokeInvitation);
  const listReqs = useServerFn(listPendingRequests);
  const decide = useServerFn(decideAccessRequest);

  const membersQuery = useQuery({
    queryKey: ["members", businessId],
    queryFn: () => list({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
  });
  const invitationsQuery = useQuery({
    queryKey: ["invitations", businessId],
    queryFn: () => listInv({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
  });
  const requestsQuery = useQuery({
    queryKey: ["access-requests", businessId],
    queryFn: () => listReqs({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
    refetchInterval: 30_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["members", businessId] });
    qc.invalidateQueries({ queryKey: ["invitations", businessId] });
    qc.invalidateQueries({ queryKey: ["access-requests", businessId] });
  };

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  const inviteMut = useMutation({
    mutationFn: () =>
      invite({ data: { business_id: businessId, email: email.trim(), role: role as Exclude<Role, "owner"> } }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["invitations", businessId] });
      toast.success("Invite sent. They'll need to sign up and request access.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: (v: { membership_id: string; role: Role }) =>
      updateRole({ data: { membership_id: v.membership_id, role: v.role } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", businessId] });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeMut = useMutation({
    mutationFn: (membership_id: string) => remove({ data: { membership_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", businessId] });
      toast.success("Removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const resendMut = useMutation({
    mutationFn: (invitation_id: string) => resend({ data: { invitation_id } }),
    onSuccess: () => toast.success("Invite re-sent"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const revokeMut = useMutation({
    mutationFn: (invitation_id: string) => revoke({ data: { invitation_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invitations", businessId] });
      toast.success("Invitation revoked");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const decideMut = useMutation({
    mutationFn: (v: { request_id: string; decision: "approve" | "deny"; role?: Role }) =>
      decide({
        data: {
          request_id: v.request_id,
          decision: v.decision,
          role: v.role as Exclude<Role, "owner"> | undefined,
        },
      }),
    onSuccess: (_, vars) => {
      invalidateAll();
      toast.success(vars.decision === "approve" ? "Approved" : "Denied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (my.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!my.can("admin")) return null;

  const members = (membersQuery.data ?? []) as Array<{
    id: string;
    user_id: string | null;
    email: string | null;
    full_name: string | null;
    role: Role;
    status: "active" | "invited";
  }>;
  const activeMembers = members.filter((m) => m.status === "active");

  const invitations = (invitationsQuery.data ?? []) as Array<{
    id: string;
    invited_email: string;
    proposed_role: Role;
    status: "sent" | "accepted" | "revoked" | "expired";
    created_at: string;
    expires_at: string;
  }>;
  const pendingInvites = invitations.filter((i) => i.status === "sent");

  const requests = (requestsQuery.data ?? []) as Array<{
    id: string;
    requester_user_id: string;
    proposed_role: Role;
    message: string | null;
    created_at: string;
    full_name: string | null;
    email: string | null;
  }>;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          inviteMut.mutate();
        }}
        className="space-y-2"
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE.map((r) => (
                <SelectItem key={r} value={r}>
                  {labelOf(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={inviteMut.isPending || !email.trim()}>
            <UserPlus className="h-4 w-4 mr-1" /> Invite
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          We'll email them a sign-up link. You'll approve their access after they sign up.
        </p>
      </form>

      {requests.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Access requests ({requests.length})
          </h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                canSetOwner={my.can("owner")}
                onDecide={(decision, finalRole) =>
                  decideMut.mutate({ request_id: r.id, decision, role: finalRole })
                }
                pending={decideMut.isPending}
              />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium mb-2 text-muted-foreground">Members</h4>
        {activeMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active members yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {activeMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{m.full_name || m.email || "Member"}</div>
                  {m.full_name && m.email && (
                    <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                  )}
                </div>
                <RoleEditor
                  value={m.role}
                  canSetOwner={my.can("owner")}
                  disabled={m.role === "owner" && !my.can("owner")}
                  onChange={(r) => updateMut.mutate({ membership_id: m.id, role: r })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title="Remove"
                  onClick={() => {
                    if (confirm("Remove this member?")) removeMut.mutate(m.id);
                  }}
                  disabled={m.role === "owner" && !my.can("owner")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingInvites.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">Invitations sent</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{i.invited_email}</div>
                  <div className="text-xs text-muted-foreground">
                    Invited as {labelOf(i.proposed_role)} ·{" "}
                    {new Date(i.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resendMut.mutate(i.id)}
                  disabled={resendMut.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Resend
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Revoke"
                  onClick={() => {
                    if (confirm("Revoke this invitation?")) revokeMut.mutate(i.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  canSetOwner,
  onDecide,
  pending,
}: {
  request: {
    id: string;
    proposed_role: Role;
    message: string | null;
    full_name: string | null;
    email: string | null;
    created_at: string;
  };
  canSetOwner: boolean;
  onDecide: (decision: "approve" | "deny", role: Role) => void;
  pending: boolean;
}) {
  const [chosenRole, setChosenRole] = useState<Role>(request.proposed_role);
  const options: Role[] = canSetOwner ? (["owner", ...ASSIGNABLE] as Role[]) : ASSIGNABLE;
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{request.full_name || request.email || "User"}</div>
        {request.email && (
          <div className="text-xs text-muted-foreground truncate">{request.email}</div>
        )}
        {request.message && (
          <div className="text-xs text-muted-foreground mt-1 italic">"{request.message}"</div>
        )}
      </div>
      <Select value={chosenRole} onValueChange={(v) => setChosenRole(v as Role)}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((r) => (
            <SelectItem key={r} value={r}>
              {labelOf(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={() => onDecide("approve", chosenRole)}
        disabled={pending}
      >
        <Check className="h-4 w-4 mr-1" /> Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDecide("deny", chosenRole)}
        disabled={pending}
      >
        <X className="h-4 w-4 mr-1" /> Deny
      </Button>
    </li>
  );
}

function RoleEditor({
  value,
  canSetOwner,
  disabled,
  onChange,
}: {
  value: Role;
  canSetOwner: boolean;
  disabled: boolean;
  onChange: (r: Role) => void;
}) {
  const options: Role[] = canSetOwner ? (["owner", ...ASSIGNABLE] as Role[]) : ASSIGNABLE;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className="w-32 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((r) => (
          <SelectItem key={r} value={r}>
            {labelOf(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function labelOf(r: Role) {
  return r[0].toUpperCase() + r.slice(1);
}
