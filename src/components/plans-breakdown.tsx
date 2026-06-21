import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICING, type Tier } from "@/lib/entitlements";
import { cn } from "@/lib/utils";

function fmtUsd(cents: number): string {
  const v = cents / 100;
  return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

type PlanRow = {
  id: Tier;
  name: string;
  tagline: string;
  price: string;
  priceSub: string;
  features: string[];
};

const PLANS: PlanRow[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Get started, no card needed.",
    price: "$0",
    priceSub: "forever",
    features: [
      `${LIMITS.free.maxBusinesses} space`,
      `${LIMITS.free.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Calendar, tasks, notes & journal",
      "Just for you",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For everything you're juggling.",
    price: fmtUsd(PRICING.pro_monthly.amount),
    priceSub: "/mo · or save with annual",
    features: [
      "Unlimited spaces & calendars",
      `${LIMITS.pro.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Meetings, summaries & weekly coach",
      "Top up AI credits anytime",
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "For teams that collaborate.",
    price: fmtUsd(PRICING.team_monthly.amount),
    priceSub: "/seat/mo · 2-seat minimum",
    features: [
      "Everything in Pro",
      `${LIMITS.team.aiAllowanceCreditsPerSeat} AI credits per seat, pooled`,
      "Sharing, roles & team progress",
      "Viewers & guests free (no seat)",
    ],
  },
];

/**
 * Plans comparison rendered inside the Billing page so users can compare
 * Free / Pro / Team without leaving Settings. Numbers are sourced from
 * the shared LIMITS / PRICING constants used by the public pricing page,
 * so the two stay in sync.
 */
export function PlansBreakdown({ currentTier }: { currentTier: Tier }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>
          Compare what's included. Upgrades, downgrades, and seat changes are handled securely at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const isCurrent = p.id === currentTier;
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
                  <span className="text-2xl font-semibold">{p.price}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{p.priceSub}</span>
                </div>
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
            <Link to="/pricing">See full plan details</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
