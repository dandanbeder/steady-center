import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { getCreditBalance } from "@/lib/credits.functions";
import { tierLabel } from "@/lib/entitlements";
import { cn } from "@/lib/utils";

/**
 * Compact, always-visible chip in the app chrome showing the user's plan
 * and remaining AI credits this cycle. Tapping opens Billing.
 * For Free users, surfaces a subtle "Upgrade" affordance.
 */
export function PlanIndicator() {
  const { tier, isLoading: subLoading } = useSubscription();
  const getBalance = useServerFn(getCreditBalance);
  const balanceQ = useQuery({
    queryKey: ["credit-balance"],
    queryFn: () => getBalance(),
    staleTime: 30_000,
  });

  if (subLoading) return null;

  const total = balanceQ.data?.total ?? null;
  const paused = balanceQ.data?.paused ?? false;
  const isFree = tier === "free";

  return (
    <Link
      to="/billing"
      title={
        isFree
          ? "You're on Free — upgrade to unlock more"
          : `${tierLabel(tier)} plan · ${total ?? 0} AI credits remaining`
      }
      className={cn(
        "group hidden sm:inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors shrink-0",
        "border-border/70 bg-muted/40 text-foreground hover:bg-muted",
        paused && "border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200",
      )}
    >
      <span className="font-medium">{tierLabel(tier)}</span>
      <span className="text-muted-foreground">·</span>
      {isFree ? (
        <span className="inline-flex items-center gap-1 text-primary font-medium">
          Upgrade <ArrowUpRight className="h-3 w-3" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Sparkles className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          {total === null ? "…" : `${total.toLocaleString()} credits`}
        </span>
      )}
    </Link>
  );
}
