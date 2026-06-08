import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMembers } from "@/lib/memberships.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserCircle2 } from "lucide-react";

export type AssignableMember = {
  user_id: string | null;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
};

const UNASSIGNED = "__unassigned__";

/** Roles that can be the actionable owner of a task. */
const ASSIGNABLE_RANKS: Record<string, number> = {
  viewer: 1,
  commenter: 2,
  member: 3,
  admin: 4,
  owner: 5,
};

export function useAssignableMembers(businessId: string | null | undefined) {
  const fn = useServerFn(listMembers);
  return useQuery({
    queryKey: ["assignable-members", businessId],
    queryFn: () => fn({ data: { business_id: businessId! } }),
    enabled: !!businessId,
    staleTime: 30_000,
  });
}

export function AssigneePicker({
  businessId,
  value,
  onChange,
  disabled,
}: {
  businessId: string | null;
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}) {
  const { data: members = [], isLoading } = useAssignableMembers(businessId);

  if (!businessId) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Personal tasks aren't assigned to other people.
      </p>
    );
  }

  const assignable = (members as AssignableMember[]).filter(
    (m) => m.status === "active" && m.user_id && (ASSIGNABLE_RANKS[m.role] ?? 0) >= 3,
  );

  return (
    <Select
      value={value ?? UNASSIGNED}
      onValueChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <UserCircle2 className="h-3.5 w-3.5" /> Unassigned
          </span>
        </SelectItem>
        {assignable.map((m) => (
          <SelectItem key={m.user_id!} value={m.user_id!}>
            {m.full_name?.trim() || m.email}
          </SelectItem>
        ))}
        {assignable.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No assignable members yet. Invite members from Settings.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

export function memberLabel(members: AssignableMember[], userId: string | null): string {
  if (!userId) return "Unassigned";
  const m = members.find((x) => x.user_id === userId);
  return m?.full_name?.trim() || m?.email || "Someone";
}
