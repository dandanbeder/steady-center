import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

export function PastDueBanner() {
  const { subscription } = useSubscription();
  if (!subscription || subscription.status !== "past_due") return null;
  return (
    <div className="flex w-full items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Your last payment failed. Update your payment method to avoid losing access.{" "}
        <Link to="/pricing" className="font-medium underline">
          Manage billing
        </Link>
      </span>
    </div>
  );
}
