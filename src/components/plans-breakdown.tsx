import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICING, SPACE_ACCOUNT_HELPER, type Tier } from "@/lib/entitlements";
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
      `${LIMITS.free.maxBusinesses} account within your space`,
      `${LIMITS.free.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Calendar, tasks, notes & journal",
      "Ask my notes — shown, unlocks on a paid plan",
    ],
  },
  {
    id: "basic",
    name: "Basic",
    tagline: "Two areas, one calm home.",
    price: `${fmtUsd(PRICING.basic_monthly.amount)}/mo`,
    priceSub: `or ${fmtUsd(Math.round(PRICING.basic_yearly.amount / 12))}/mo billed annually`,
    features: [
      `${LIMITS.basic.maxBusinesses} accounts within your space`,
      `${LIMITS.basic.aiAllowanceCreditsPerSeat} AI credits / month`,
      "Everything in Free, plus Reporting & Meetings",
      "Ask my notes — shown, unlocks on Standard",
    ],
  },
  {
    id: "pro",
    name: "Standard",
    tagline: "For everything you're juggling.",
    price: `${fmtUsd(PRICING.pro_monthly.amount)}/mo`,
    priceSub: `or ${fmtUsd(Math.round(PRICING.pro_yearly.amount / 12))}/mo billed annually`,
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
    price: `${fmtUsd(PRICING.team_monthly.amount)}/seat/mo`,
    priceSub: `or ${fmtUsd(Math.round(PRICING.team_yearly.amount / 12))}/seat billed annually · 2-seat minimum`,
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
 * from the shared LIMITS / PRICING constants used by the public pricing page,
 * so the two stay in sync.
 */
export function PlansBreakdown({ currentTier }: { currentTier: Tier }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>{SPACE_ACCOUNT_HELPER}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                </div>
                <p className="text-xs text-muted-foreground">{p.priceSub}</p>
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
