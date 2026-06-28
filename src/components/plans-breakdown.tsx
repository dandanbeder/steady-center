import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICING, SPACE_ACCOUNT_HELPER, TEAM_MIN_SEATS, type Tier } from "@/lib/entitlements";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { createCustomerPortalUrl } from "@/utils/payments.functions";
import { getPaddleEnvironment } from "@/lib/paddle";

type Cycle = "month" | "year";

const TIER_RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2, team: 3 };

function fmtUsd(cents: number): string {
  const v = cents / 100;
  return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

type PlanRow = {
  id: Tier;
  name: string;
  tagline: string;
  /** Returns price + optional suffix + sublabel for the chosen cycle. */
  price: (cycle: Cycle) => { main: string; suffix?: string; sub: string };
  features: string[];
  /** Optional invitation-style note for lower tiers (e.g. "Unlocks on Standard"). */
  note?: string;
};

/**
 * Feature lists are derived from `LIMITS` (the single source of truth used by
 * server-side entitlement checks). Cards, enforced limits, and Paddle
 * checkout therefore always agree about what each plan unlocks.
 */
const PLANS: PlanRow[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try Heartbeat, free forever.",
    price: () => ({ main: "$0", sub: "forever" }),
    features: [
      "One calm space with calendar, tasks, notes and journal in one place",
      `A taste of AI, ${LIMITS.free.aiAllowanceCreditsPerSeat} credits per month`,
      `${LIMITS.free.maxBusinesses} account`,
    ],
    note: "Ask my notes unlocks on Standard",
  },
  {
    id: "basic",
    name: "Basic",
    tagline: "For running more than one thing.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: fmtUsd(Math.round(PRICING.basic_yearly.amount / 12)),
            suffix: "/mo",
            sub: `Billed ${fmtUsd(PRICING.basic_yearly.amount)} yearly, save 18%`,
          }
        : {
            main: fmtUsd(PRICING.basic_monthly.amount),
            suffix: "/mo",
            sub: "Billed monthly",
          },
    features: [
      "Organise two businesses or areas separately",
      "Meeting summaries plus weekly reporting",
      `${LIMITS.basic.aiAllowanceCreditsPerSeat} AI credits / month`,
      `${LIMITS.basic.maxBusinesses} accounts`,
    ],
    note: "Ask my notes unlocks on Standard",
  },
  {
    id: "pro",
    name: "Standard",
    tagline: "For everything you're juggling.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: fmtUsd(Math.round(PRICING.pro_yearly.amount / 12)),
            suffix: "/mo",
            sub: `Billed ${fmtUsd(PRICING.pro_yearly.amount)} yearly, save 18%`,
          }
        : {
            main: fmtUsd(PRICING.pro_monthly.amount),
            suffix: "/mo",
            sub: "Billed monthly",
          },
    features: [
      "Ask anything across your notes, tasks and meetings and get sourced answers",
      "Organise up to four areas",
      `${LIMITS.pro.aiAllowanceCreditsPerSeat} AI credits / month`,
      `${LIMITS.pro.maxBusinesses} accounts`,
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "For working together.",
    price: (cycle) =>
      cycle === "year"
        ? {
            main: fmtUsd(Math.round(PRICING.team_yearly.amount / 12)),
            suffix: "/seat/mo",
            sub: `Billed ${fmtUsd(PRICING.team_yearly.amount)}/seat yearly, save 18%`,
          }
        : {
            main: fmtUsd(PRICING.team_monthly.amount),
            suffix: "/seat/mo",
            sub: `Billed monthly, ${TEAM_MIN_SEATS}-seat minimum`,
          },
    features: [
      "Share work without losing your own private space",
      "Roles and team progress",
      `Pooled AI credits, ${LIMITS.team.aiAllowanceCreditsPerSeat} per seat`,
      "Viewers and guests free",
      "Unlimited accounts plus shared spaces",
    ],
  },
];

function priceIdFor(tier: Tier, cycle: Cycle): string | null {
  if (tier === "free") return null;
  if (tier === "basic") return cycle === "year" ? "basic_yearly" : "basic_monthly";
  if (tier === "pro") return cycle === "year" ? "pro_yearly" : "pro_monthly";
  return cycle === "year" ? "team_yearly" : "team_monthly";
}

/**
 * Plans comparison rendered inside the Billing page. Each card is actionable:
 *   - Current plan shows a "Current" badge, no buy button.
 *   - Higher tiers route to Paddle checkout for the selected cycle.
 *   - Lower tiers (downgrade) open the Paddle customer portal.
 *
 * Entitlements are written ONLY by the Paddle webhook (`subscriptions` table
 * via service role). Nothing here mutates plan state client-side, and RLS on
 * `subscriptions` forbids it (users SELECT their own row, all writes require
 * service role).
 */
export function PlansBreakdown({ currentTier }: { currentTier: Tier }) {
  const [cycle, setCycle] = useState<Cycle>("year");
  const [busy, setBusy] = useState<Tier | null>(null);

  const { user } = useAuth();
  const navigate = useNavigate();
  const env = getPaddleEnvironment();
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();
  const portalFn = useServerFn(createCustomerPortalUrl);

  const handleUpgrade = async (tier: Tier) => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    const priceId = priceIdFor(tier, cycle);
    if (!priceId) return;
    setBusy(tier);
    try {
      await openCheckout({
        priceId,
        quantity: tier === "team" ? TEAM_MIN_SEATS : 1,
        customerEmail: user.email ?? undefined,
        customData: { userId: user.id },
        successUrl: `${window.location.origin}/billing?checkout=success`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
    } finally {
      setBusy(null);
    }
  };

  const handleDowngrade = async (tier: Tier) => {
    setBusy(tier);
    try {
      const { url } = await portalFn({ data: { environment: env } });
      window.open(url, "_blank", "noopener,noreferrer");
      toast.message("Opened billing portal", {
        description: "Switch or cancel from your Paddle portal.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open billing portal");
    } finally {
      setBusy(null);
    }
  };

  const renderCta = (tier: Tier) => {
    if (tier === currentTier) {
      return (
        <Button variant="outline" size="sm" disabled className="w-full">
          Current plan
        </Button>
      );
    }
    const isBusy = busy === tier || checkoutLoading;
    const myRank = TIER_RANK[currentTier];
    const targetRank = TIER_RANK[tier];

    // Upgrade path: higher tier than current.
    if (targetRank > myRank) {
      if (tier === "free") {
        // Free is never "higher", only reached for someone already on free.
        return null;
      }
      return (
        <Button
          size="sm"
          className="w-full"
          onClick={() => handleUpgrade(tier)}
          disabled={isBusy}
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Upgrade to ${tier === "pro" ? "Standard" : tier === "team" ? "Team" : "Basic"}`}
        </Button>
      );
    }

    // Downgrade path (incl. moving to Free): manage via Paddle portal.
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => handleDowngrade(tier)}
        disabled={isBusy}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {tier === "free" ? "Cancel in portal" : `Switch to ${tier === "pro" ? "Standard" : tier === "basic" ? "Basic" : "Team"}`}
            <ExternalLink className="ml-1 h-3 w-3" />
          </>
        )}
      </Button>
    );
  };

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
            const { main, suffix, sub } = p.price(cycle);
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
                <div className="mt-3 min-h-[3.5rem]">
                  <span className="text-2xl font-semibold">{main}</span>
                  {suffix ? (
                    <span className="block text-sm font-medium text-foreground">{suffix}</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{sub}</p>
                <ul className="mt-3 space-y-1.5 text-sm flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {p.note ? (
                  <p className="mt-2 text-xs text-muted-foreground italic">{p.note}</p>
                ) : null}
                <div className="mt-4">{renderCta(p.id)}</div>
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
