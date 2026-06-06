import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getPaddleEnvironment } from "@/lib/paddle";

export type Subscription = {
  id: string;
  user_id: string;
  paddle_subscription_id: string;
  paddle_customer_id: string;
  product_id: string;
  price_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  environment: "sandbox" | "live";
  created_at: string;
  updated_at: string;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function useSubscription() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const env = getPaddleEnvironment();

  const query = useQuery({
    queryKey: ["subscription", user?.id, env],
    enabled: !!user,
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Subscription | null) ?? null;
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`subscriptions:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["subscription", user.id, env] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, env, queryClient]);

  const sub = query.data;
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  const inPeriod = !periodEnd || periodEnd > new Date();
  const isActive = !!sub && (
    (ACTIVE_STATUSES.has(sub.status) && inPeriod) ||
    (sub.status === "canceled" && !!periodEnd && periodEnd > new Date())
  );

  const tier: "free" | "pro" | "team" = !isActive
    ? "free"
    : sub?.product_id === "team_plan"
      ? "team"
      : sub?.product_id === "pro_plan"
        ? "pro"
        : "free";

  return {
    subscription: sub,
    isActive,
    tier,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
