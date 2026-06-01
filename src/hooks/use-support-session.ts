import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminGetActiveSession } from "@/lib/admin.functions";

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
  const fn = useServerFn(adminGetActiveSession);
  return useQuery({
    queryKey: ["admin", "active-session"],
    queryFn: () => fn(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
