import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { myRole } from "@/lib/memberships.functions";

export type Role = "owner" | "admin" | "member" | "commenter" | "viewer";

const RANK: Record<Role, number> = {
  viewer: 1, commenter: 2, member: 3, admin: 4, owner: 5,
};

export function canRole(role: Role | null, isPlatformAdmin: boolean, min: Role): boolean {
  if (isPlatformAdmin) return true;
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/**
 * Returns the caller's role in the given business (or null if not a member).
 * If business_id is null/undefined (e.g. "All" view), returns null role with loading=false.
 */
export function useMyRole(business_id: string | null | undefined) {
  const fn = useServerFn(myRole);
  const query = useQuery({
    queryKey: ["my-role", business_id],
    queryFn: () => fn({ data: { business_id: business_id! } }),
    enabled: !!business_id,
    staleTime: 30_000,
  });

  const role = (query.data?.role ?? null) as Role | null;
  const isPlatformAdmin = !!query.data?.isPlatformAdmin;

  return {
    role,
    isPlatformAdmin,
    isLoading: query.isLoading,
    can: (min: Role) => canRole(role, isPlatformAdmin, min),
  };
}
