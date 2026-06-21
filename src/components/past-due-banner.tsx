import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

const GRACE_DAYS = 3;

export function PastDueBanner() {
  const { subscription } = useSubscription();
  if (!subscription || subscription.status !== "past_due") return null;
  const since = subscription.past_due_since
    ? new Date(subscription.past_due_since)
    : new Date();
  const elapsedMs = Date.now() - since.getTime();
  const elapsedDays = elapsedMs / 86_400_000;
  const daysLeft = Math.max(0, Math.ceil(GRACE_DAYS - elapsedDays));
  const expired = elapsedDays >= GRACE_DAYS;
  return (
    <div
      className={`flex w-full items-center justify-center gap-2 border-b px-4 py-2 text-center text-sm ${
        expired
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        {expired
          ? "Your subscription is past due, premium features are paused."
          : `Payment failed. ${daysLeft} day${daysLeft === 1 ? "" : "s"} left to update your payment method.`}{" "}
        <Link to="/billing" className="font-medium underline">
          Update billing
        </Link>
      </span>
    </div>
  );
}
