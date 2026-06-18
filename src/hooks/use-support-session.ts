import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminGetActiveSession } from "@/lib/admin.functions";
import { checkIsPlatformAdmin } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";

export type ActiveSupportSession = {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  mode: "read" | "write";
  started_at: string;
  ended_at: string | null;
  target_email: string;
  target_name: string;
};

export function useActiveSupportSession() {
  const { user } = useAuth();
  const isAdminFn = useServerFn(checkIsPlatformAdmin);
  const fn = useServerFn(adminGetActiveSession);

  // Only platform admins can read admin_access_log. For everyone else, skip
  // the polling entirely — otherwise the protected server fn 401s on a 30s
  // loop in the network tab for ordinary users.
  const adminQ = useQuery({
    queryKey: ["is-platform-admin", user?.id],
    queryFn: () => isAdminFn().then((r) => !!(r as { isAdmin?: boolean }).isAdmin),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  return useQuery({
    queryKey: ["admin", "active-session"],
    queryFn: () => fn(),
    enabled: !!user && adminQ.data === true,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
