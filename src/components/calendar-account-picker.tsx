import { Check, ChevronDown, Info, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Business } from "@/lib/businesses";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Calendar → Account mapping picker.
 *
 * Differs from the generic AccountSelector in three ways:
 * - When unset, shows an action-style "Assign to an account…" placeholder.
 * - "No business" option is explicit and labelled "Personal (no account)".
 * - When the user has no Accounts, renders a CTA linking to settings.
 *
 * RLS: `businesses` is already filtered to the signed-in user.
 */
export function CalendarAccountPicker({
  businesses,
  value,
  onChange,
  disabled,
}: {
  businesses: Business[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const active = value ? businesses.find((b) => b.id === value) ?? null : null;
  const hasNone = businesses.length === 0;

  // When unset (null), use an action-style placeholder rather than a passive
  // label. Picking "Personal (no account)" persists null too, we can't
  // distinguish "unassigned" from "personal" once saved, so the trigger
  // keeps prompting until a business is chosen.
  const triggerLabel = active ? active.name : "Assign to an account…";
  const triggerTone = active ? "text-foreground" : "text-primary";

  return (
    <div className="inline-flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={`inline-flex items-center gap-2 rounded-md border border-input bg-background hover:bg-muted transition-colors px-2 py-1 text-xs ${triggerTone}`}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{
                backgroundColor: active?.color ?? "var(--muted-foreground)",
                opacity: active ? 1 : 0.4,
              }}
            />
            <span className="truncate max-w-[14rem]">{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Tag events from this calendar with…
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {hasNone ? (
            <DropdownMenuItem asChild>
              <Link to="/settings" className="flex items-start gap-2">
                <Plus className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span>Create an account to assign</span>
                  <span className="text-xs text-muted-foreground">
                    You don&apos;t have any Accounts yet.
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
          ) : (
            businesses.map((b) => (
              <DropdownMenuItem key={b.id} onClick={() => onChange(b.id)}>
                <span
                  className="h-2.5 w-2.5 rounded-full mr-2 shrink-0"
                  style={{ backgroundColor: b.color }}
                />
                <span className="truncate">{b.name}</span>
                {value === b.id && <Check className="h-3.5 w-3.5 ml-auto" />}
              </DropdownMenuItem>
            ))
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange(null)}>
            <span className="h-2.5 w-2.5 rounded-full mr-2 bg-muted-foreground/40 shrink-0" />
            <div className="flex flex-col">
              <span>Personal (no account)</span>
              <span className="text-xs text-muted-foreground">
                Events stay visible but aren&apos;t tied to any Account.
              </span>
            </div>
            {value === null && <Check className="h-3.5 w-3.5 ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground hover:text-foreground cursor-help">
              <Info className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            Events from this calendar are tagged with this account.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
