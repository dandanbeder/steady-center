import { Check, ChevronDown } from "lucide-react";
import type { Business } from "@/lib/businesses";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * AccountSelector, the canonical first-class Account picker.
 *
 * Use this in Calendar, Tasks, Outcomes, Notes, Meetings and Connections
 * any time the user needs to pick which Account a thing belongs to.
 * The Account colour is always shown so the same business context reads
 * the same way everywhere it appears.
 *
 * RLS: this component only renders Accounts the user can already see;
 * `listBusinesses()` returns only rows visible under the private-first
 * row level security policies.
 */
export function AccountSelector({
  businesses,
  value,
  onChange,
  allowNone = true,
  noneLabel = "No account",
  className = "",
  size = "default",
  disabled,
}: {
  businesses: Business[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  const active = value ? businesses.find((b) => b.id === value) ?? null : null;
  const padding = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  const dot = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md border border-input bg-background hover:bg-muted transition-colors ${padding} ${className}`}
        >
          <span
            className={`${dot} rounded-full shrink-0`}
            style={{ backgroundColor: active?.color ?? "var(--muted-foreground)" }}
          />
          <span className="truncate">{active ? active.name : noneLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {allowNone && (
          <>
            <DropdownMenuItem onClick={() => onChange(null)}>
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground mr-2" />
              {noneLabel}
              {value === null && <Check className="h-3.5 w-3.5 ml-auto" />}
            </DropdownMenuItem>
            {businesses.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {businesses.map((b) => (
          <DropdownMenuItem key={b.id} onClick={() => onChange(b.id)}>
            <span className="h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: b.color }} />
            <span className="truncate">{b.name}</span>
            {value === b.id && <Check className="h-3.5 w-3.5 ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small inline pill that shows an Account's colour + name. */
export function AccountBadge({
  business,
  className = "",
}: {
  business: Pick<Business, "name" | "color"> | null | undefined;
  className?: string;
}) {
  if (!business) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs ${className}`}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: business.color }} />
      <span className="truncate max-w-[10rem]">{business.name}</span>
    </span>
  );
}
