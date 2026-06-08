import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getMyPlanContext } from "@/lib/plan.functions";

export type PlanContextData = {
  tier: "free" | "pro" | "team";
  quantity: number;
  billingCycle: "month" | "year";
  paidSeats: number;
  trialEnd: string | null;
  aiCap: number;
  aiUsed: number;
  aiSpendCapCents: number;
  aiSpendUsedCents: number;
};

export function usePlanContext() {
  const { user } = useAuth();
  const fetchPlan = useServerFn(getMyPlanContext);
  const q = useQuery({
    queryKey: ["plan-context", user?.id],
    enabled: !!user,
    queryFn: async () => (await fetchPlan()) as PlanContextData,
    staleTime: 30_000,
  });
  return {
    plan: q.data,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
