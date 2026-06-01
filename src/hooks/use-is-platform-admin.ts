import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsPlatformAdmin } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";

export function useIsPlatformAdmin() {
  const { user } = useAuth();
  const fn = useServerFn(checkIsPlatformAdmin);
  const q = useQuery({
    queryKey: ["is-platform-admin", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 60_000,
  });
  return { isAdmin: !!q.data?.isAdmin, isLoading: q.isLoading };
}
