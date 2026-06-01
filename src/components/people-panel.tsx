import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  inviteMember,
  listMembers,
  removeMember,
  resendInvite,
  updateMemberRole,
} from "@/lib/memberships.functions";
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
  const invite = useServerFn(inviteMember);
  const updateRole = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const resend = useServerFn(resendInvite);

  const membersQuery = useQuery({
    queryKey: ["members", businessId],
    queryFn: () => list({ data: { business_id: businessId } }),
    enabled: my.can("admin"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["members", businessId] });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  const inviteMut = useMutation({
    mutationFn: () =>
      invite({ data: { business_id: businessId, email: email.trim(), role: role as any } }),
    onSuccess: (r) => {
      setEmail("");
      invalidate();
      toast.success(r?.sent_email ? "Invite sent" : "Member added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: (v: { membership_id: string; role: Role }) =>
      updateRole({ data: { membership_id: v.membership_id, role: v.role } }),
    onSuccess: () => {
      invalidate();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeMut = useMutation({
    mutationFn: (membership_id: string) => remove({ data: { membership_id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const resendMut = useMutation({
    mutationFn: (membership_id: string) => resend({ data: { membership_id } }),
    onSuccess: () => toast.success("Invite re-sent"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (my.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!my.can("admin")) {
    return null;
  }

  const members = (membersQuery.data ?? []) as Array<{
    id: string;
    user_id: string | null;
    email: string | null;
    full_name: string | null;
    role: Role;
    status: "active" | "invited";
  }>;

  const active = members.filter((m) => m.status === "active");
  const pending = members.filter((m) => m.status === "invited");

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          inviteMut.mutate();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
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
      </form>

      <div>
        <h4 className="text-sm font-medium mb-2 text-muted-foreground">Members</h4>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active members yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {active.map((m) => (
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

      {pending.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">Pending invites</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pending.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{m.email}</div>
                  <div className="text-xs text-muted-foreground">Invited as {labelOf(m.role)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resendMut.mutate(m.id)}
                  disabled={resendMut.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Resend
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Revoke"
                  onClick={() => {
                    if (confirm("Revoke this invite?")) removeMut.mutate(m.id);
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
  const options: Role[] = canSetOwner
    ? ["owner", "admin", "member", "commenter", "viewer"]
    : ASSIGNABLE;
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
