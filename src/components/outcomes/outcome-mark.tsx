import { Target } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * A small, calm marker for tasks that ladder up to an Outcome.
 * Subtle by default, a single icon with tooltip; click-through to the outcome.
 */
export function OutcomeMark({
  outcomeId,
  outcomeName,
  size = "sm",
  className,
}: {
  outcomeId: string;
  outcomeName?: string | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  const label = outcomeName
    ? `Moves outcome forward: ${outcomeName}`
    : "Linked to an outcome";
  const iconCls = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <Link
      to="/outcomes"
      search={{ focus: outcomeId }}
      onClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center text-accent/70 hover:text-accent transition-colors shrink-0",
        className,
      )}
    >
      <Target className={iconCls} />
    </Link>
  );
}
