import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { usePlanContext } from "@/hooks/use-plan-context";

export function AiUsageMeter({ compact = false }: { compact?: boolean }) {
  const { plan, isLoading } = usePlanContext();
  if (isLoading || !plan) return null;
  const pct = plan.aiCap > 0 ? Math.min(100, Math.round((plan.aiUsed / plan.aiCap) * 100)) : 0;
  const over = plan.aiUsed >= plan.aiCap;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI actions this month</span>
        </div>
        <span className={`text-sm tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
          {plan.aiUsed} / {plan.aiCap}
        </span>
      </div>
      <Progress value={pct} className={`mt-2 ${over ? "[&>div]:bg-destructive" : ""}`} />
      {!compact && over && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            You've hit your monthly limit. Upgrade for more.
          </span>
          <Button size="sm" asChild>
            <Link to="/billing">Manage</Link>
          </Button>
        </div>
      )}
      {!compact && !over && plan.tier === "free" && pct >= 75 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Approaching your Free limit — <Link to="/billing" className="underline">manage your plan</Link> for more actions.
        </p>
      )}
    </div>
  );
}
