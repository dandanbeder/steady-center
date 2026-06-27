import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICING, SPACE_ACCOUNT_HELPER, type Tier } from "@/lib/entitlements";
import { cn } from "@/lib/utils";

type Cycle = "month" | "year";

function fmtUsd(cents: number): string {
  const v = cents / 100;
  return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

type PlanRow = {
  id: Tier;
  name: string;
  tagline: string;
  /** Returns price + sublabel for the chosen cycle. */
  price: (cycle: Cycle) => { main: string; sub: string };
  features: string[];
};

const PLANS: PlanRow[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Get started, no card needed.",
    price: () => ({ main: "$0", sub: "forever" }),
    features: [
      `${LIMITS.free.maxBusinesses} account within your space`,
      `${LIMITS.free.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Calendar, tasks, notes & journal",
      "Ask my notes, shown, unlocks on a paid plan",
    ],
  },
  {
    id: "basic",
    name: "Basic",
    tagline: "Two areas, one calm home.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: `${fmtUsd(Math.round(PRICING.basic_yearly.amount / 12))}/mo`,
            sub: `Billed ${fmtUsd(PRICING.basic_yearly.amount)} yearly, save 18%`,
          }
        : {
            main: `${fmtUsd(PRICING.basic_monthly.amount)}/mo`,
            sub: "Billed monthly",
          },
    features: [
      `${LIMITS.basic.maxBusinesses} accounts within your space`,
      `${LIMITS.basic.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Everything in Free, plus Reporting & Meetings",
      "Ask my notes, shown, unlocks on Standard",
    ],
  },
  {
    id: "pro",
    name: "Standard",
    tagline: "For everything you're juggling.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: `${fmtUsd(Math.round(PRICING.pro_yearly.amount / 12))}/mo`,
            sub: `Billed ${fmtUsd(PRICING.pro_yearly.amount)} yearly, save 18%`,
          }
        : {
            main: `${fmtUsd(PRICING.pro_monthly.amount)}/mo`,
            sub: "Billed monthly",
          },
    features: [
      `${LIMITS.pro.maxBusinesses} accounts within your space`,
      `${LIMITS.pro.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Everything in Basic, plus Ask my notes (full)",
      "Top up AI credits anytime",
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "For teams that collaborate.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: `${fmtUsd(Math.round(PRICING.team_yearly.amount / 12))}/seat/mo`,
            sub: `Billed ${fmtUsd(PRICING.team_yearly.amount)}/seat yearly, save 18%`,
          }
        : {
            main: `${fmtUsd(PRICING.team_monthly.amount)}/seat/mo`,
            sub: "Billed monthly, 2-seat minimum",
          },
    features: [
      "Multiple accounts + shared team spaces",
      `${LIMITS.team.aiAllowanceCreditsPerSeat} AI credits per seat, pooled`,
      "Everything in Standard, plus Sharing, roles & team progress",
      "Viewers & guests free (no seat)",
    ],
  },
];

/**
 * Plans comparison rendered inside the Billing page so users can compare
 * Free / Basic / Standard / Team without leaving Settings. Numbers are sourced
 * from the shared LIMITS / PRICING constants, kept in sync with /pricing.
 *
 * The Monthly/Annual toggle here is purely a display switch; the actual
 * checkout (which sends the matching priceId to Paddle) happens on /pricing
 * where the same toggle drives `priceId` selection end-to-end.
 */
export function PlansBreakdown({ currentTier }: { currentTier: Tier }) {
  const [cycle, setCycle] = useState<Cycle>("year");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Plans</CardTitle>
            <CardDescription>{SPACE_ACCOUNT_HELPER}</CardDescription>
          </div>
          <div className="inline-flex shrink-0 rounded-full border bg-muted/40 p-1 text-sm">
            <button
              type="button"
              onClick={() => setCycle("month")}
              className={cn(
                "rounded-full px-3 py-1 transition",
                cycle === "month" ? "bg-background shadow" : "text-muted-foreground",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("year")}
              className={cn(
                "rounded-full px-3 py-1 transition",
                cycle === "year" ? "bg-background shadow" : "text-muted-foreground",
              )}
            >
              Annual{" "}
              <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                Save 18%
              </span>
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => {
            const isCurrent = p.id === currentTier;
            const { main, sub } = p.price(cycle);
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-lg border p-4 flex flex-col",
                  isCurrent ? "border-primary/60 bg-primary/5" : "border-border bg-card/50",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{p.name}</div>
                  {isCurrent && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>
                <div className="mt-3">
                  <span className="text-2xl font-semibold">{main}</span>
                </div>
                <p className="text-xs text-muted-foreground">{sub}</p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/pricing" search={{ cycle }}>
              See full plan details
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
