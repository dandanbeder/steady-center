import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Users,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { AiUsageMeter } from "@/components/ai-usage-meter";
import { CreditBalanceCard } from "@/components/credit-balance-card";
import { PlansBreakdown } from "@/components/plans-breakdown";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  createCustomerPortalUrl,
} from "@/utils/payments.functions";
import {
  cancelSubscription,
  getSeatSummary,
  resumeSubscription,
  switchBillingCycle,
  updateSeats,
} from "@/lib/subscriptions.functions";
import { PRICING, tierLabel } from "@/lib/entitlements";
import { getTrialEligibility, startFreeTrial } from "@/lib/trial.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
  head: () => ({
    meta: [
      { title: "Billing, Heartbeat" },
      { name: "description", content: "Manage your Heartbeat subscription, seats, and invoices." },
    ],
  }),
});

function fmtDate(d: string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function BillingPage() {
  const { user } = useAuth();
  const { subscription, tier, isActive } = useSubscription();
  const env = getPaddleEnvironment();
  const qc = useQueryClient();

  const fetchSummary = useServerFn(getSeatSummary);
  const seatsFn = useServerFn(updateSeats);
  const switchFn = useServerFn(switchBillingCycle);
  const cancelFn = useServerFn(cancelSubscription);
  const resumeFn = useServerFn(resumeSubscription);
  const portalFn = useServerFn(createCustomerPortalUrl);

  const [busy, setBusy] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["seat-summary", env, user?.id],
    enabled: !!user,
    queryFn: () => fetchSummary({ data: { environment: env } }),
  });

  const refetchAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["seat-summary"] }),
      qc.invalidateQueries({ queryKey: ["subscription"] }),
      qc.invalidateQueries({ queryKey: ["plan-context"] }),
    ]);
  };

  const handleSeats = async (delta: number) => {
    setBusy("seats");
    try {
      const r = await seatsFn({ data: { environment: env, delta } });
      if (r.unchanged) toast.message("No change needed");
      else toast.success(`Seat count updated to ${r.quantity}`);
      await refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update seats");
    } finally {
      setBusy(null);
    }
  };

  const handleSwitch = async (cycle: "month" | "year") => {
    setBusy("switch");
    try {
      const r = await switchFn({ data: { environment: env, cycle } });
      if (!r.changed) toast.message("Already on that billing cycle");
      else toast.success(`Switched to ${cycle === "year" ? "annual" : "monthly"} billing`);
      await refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch billing cycle");
    } finally {
      setBusy(null);
    }
  };

  const handlePortal = async () => {
    setBusy("portal");
    try {
      const { url } = await portalFn({ data: { environment: env } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open billing portal");
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy("cancel");
    try {
      await cancelFn({ data: { environment: env } });
      toast.success("Cancellation scheduled for end of current period");
      await refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(null);
    }
  };

  const handleResume = async () => {
    setBusy("resume");
    try {
      await resumeFn({ data: { environment: env } });
      toast.success("Cancellation removed, subscription continues");
      await refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resume");
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;

  if (!isActive || !subscription) {
    return <FreePlanView env={env} qc={qc} />;
  }

  const s = summary.data;
  const isTeam = subscription.product_id === "team_plan";
  const cycle = subscription.billing_cycle;
  const cyclePretty = cycle === "year" ? "Annual" : "Monthly";

  return (
    <div>
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
        <header>
          <h1 className="text-4xl">Billing</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your Heartbeat subscription, seats, and invoices.
          </p>
        </header>

        {/* Plan summary */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{tierLabel(tier)} plan</CardTitle>
                <CardDescription>
                  {cyclePretty} billing
                  {subscription.cancel_at_period_end && " · cancels at period end"}
                </CardDescription>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  subscription.status === "active" || subscription.status === "trialing"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : subscription.status === "past_due"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {subscription.status}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid gap-4 ${isTeam ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Renews</div>
                <div className="mt-1 text-sm font-medium">{fmtDate(subscription.current_period_end)}</div>
              </div>
              {isTeam ? (
                <>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Paid seats</div>
                    <div className="mt-1 text-sm font-medium tabular-nums">
                      {s ? `${s.paidUsed} / ${s.paidPurchased}` : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Free collaborators</div>
                    <div className="mt-1 text-sm font-medium tabular-nums">{s?.freeUsed ?? "-"}</div>
                  </div>
                </>
              ) : (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Collaboration</div>
                  <div className="mt-1 text-sm">
                    <Link to="/pricing" search={{ upgrade: "team" } as never} className="font-medium text-primary hover:underline">
                      Upgrade to Team to add seats
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handlePortal} disabled={busy === "portal"}>
                {busy === "portal" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Update payment method
              </Button>
              <Button variant="outline" onClick={handlePortal} disabled={busy === "portal"}>
                <ExternalLink className="h-4 w-4" />
                Invoices &amp; receipts
              </Button>
              {subscription.cancel_at_period_end ? (
                <Button variant="default" onClick={handleResume} disabled={busy === "resume"}>
                  {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Resume subscription
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" className="text-destructive hover:text-destructive">
                      Cancel subscription
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You'll keep access to {tier} features until{" "}
                        <strong>{fmtDate(subscription.current_period_end)}</strong>.
                        After that, your account drops to Free and extra accounts/calendars become read-only.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep plan</AlertDialogCancel>
                      <AlertDialogAction onClick={handleCancel} disabled={busy === "cancel"}>
                        Yes, cancel
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Seat management (Team only) */}
        {isTeam && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" /> Paid seats
              </CardTitle>
              <CardDescription>
                Add or remove paid seats. Viewers and commenters don't count.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{subscription.quantity}</div>
                  <div className="text-xs text-muted-foreground">paid seats purchased</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleSeats(-1)}
                    disabled={busy === "seats" || subscription.quantity <= 2 || (s?.paidUsed ?? 0) >= subscription.quantity}
                    title={
                      (s?.paidUsed ?? 0) >= subscription.quantity
                        ? "Demote a paid member first"
                        : subscription.quantity <= 2
                          ? "Minimum 2 seats"
                          : "Remove a seat"
                    }
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => handleSeats(1)}
                    disabled={busy === "seats"}
                  >
                    {busy === "seats" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add seat
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Adding a seat charges a prorated amount immediately. Removing a seat applies credit at your next renewal.
              </p>

              {/* Transparent per-seat breakdown: display only, never auto-charges members */}
              {(() => {
                const seats = subscription.quantity ?? 2;
                const perSeatCents =
                  cycle === "year" ? PRICING.team_yearly.amount : PRICING.team_monthly.amount;
                const totalCents = perSeatCents * seats;
                const fmt = (c: number) =>
                  `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                const cycleLabel = cycle === "year" ? "/yr" : "/mo";
                return (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-4 space-y-2">
                    <div className="text-sm font-medium">Per-seat breakdown</div>
                    <div className="text-sm tabular-nums">
                      {fmt(perSeatCents)}{cycleLabel} × {seats} seats ={" "}
                      <span className="font-semibold">{fmt(totalCents)}{cycleLabel}</span>
                    </div>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      That's <span className="font-medium text-foreground">{fmt(totalCents / seats)}{cycleLabel}</span> each
                      if your team splits the bill.
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You're billed once for the full team total. Heartbeat never charges your members directly.
                      Settle among yourselves however you like.
                    </p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Billing cycle is controlled in the Plans section below. */}

        {/* Plans breakdown */}
        <PlansBreakdown currentTier={tier} />

        {/* AI credits */}
        <div className="space-y-2">
          <CreditBalanceCard />
          <div className="flex justify-end">
            <Link to="/ai" className="text-xs text-muted-foreground hover:underline">
              Open AI wallet and usage
            </Link>
          </div>
        </div>

        {/* Legacy AI $ usage meter (defense in depth for the user-set $ cap) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> AI spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AiUsageMeter compact />
          </CardContent>
        </Card>


        <p className="text-center text-xs text-muted-foreground">
          Payments handled by Paddle as merchant of record.
        </p>
      </div>
    </div>
  );
}

function FreePlanView({
  env,
  qc,
}: {
  env: "sandbox" | "live";
  qc: ReturnType<typeof useQueryClient>;
}) {
  const startFn = useServerFn(startFreeTrial);
  const eligFn = useServerFn(getTrialEligibility);
  const [busy, setBusy] = useState<"team" | "basic" | "pro" | null>(null);

  const elig = useQuery({
    queryKey: ["trial-eligibility", env],
    queryFn: () => eligFn({ data: { environment: env } }),
  });

  const handleStartTeamTrial = async () => {
    setBusy("team");
    try {
      await startFn({ data: { plan: "team", environment: env } });
      toast.success("Team trial started. 7 days, no card required.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["subscription"] }),
        qc.invalidateQueries({ queryKey: ["plan-context"] }),
        qc.invalidateQueries({ queryKey: ["trial-eligibility"] }),
        qc.invalidateQueries({ queryKey: ["account-entitlements"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start trial");
    } finally {
      setBusy(null);
    }
  };

  const goToPricing = (plan: "basic" | "pro") => {
    setBusy(plan);
    // Pricing page hosts the Paddle checkout flow.
    window.location.assign(`/pricing?upgrade=${plan}`);
  };

  const eligible = elig.data?.eligible ?? false;
  const usedPlan = elig.data?.trialPlan;

  return (
    <div>
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="text-center">
          <h1 className="text-3xl">You're on the Free plan</h1>
          <p className="mt-2 text-muted-foreground">
            Free is yours for as long as you like. Want to work with a team? Try Team free for 7 days. No card required.
          </p>
        </div>

        {elig.isLoading ? null : (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Basic</CardTitle>
                <CardDescription className="break-words">
                  2 accounts within your space, 300 AI credits/mo, meetings &amp; reports.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => goToPricing("basic")}
                  disabled={busy !== null}
                >
                  {busy === "basic" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upgrade to Basic"}
                </Button>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Standard</CardTitle>
                <CardDescription className="break-words">
                  4 accounts within your space, 400 AI credits/mo, Ask my notes (full).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => goToPricing("pro")}
                  disabled={busy !== null}
                >
                  {busy === "pro" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upgrade to Standard"}
                </Button>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-primary/40">
              <CardHeader>
                <CardTitle>Team</CardTitle>
                <CardDescription className="break-words">
                  Multiple accounts + shared team spaces, roles &amp; sharing (2 seats).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {eligible ? (
                  <>
                    <Button
                      className="w-full"
                      onClick={handleStartTeamTrial}
                      disabled={busy !== null}
                    >
                      {busy === "team" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start 7-day Team trial"}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">No card required.</p>
                  </>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      onClick={() => (window.location.href = "/pricing?upgrade=team")}
                      disabled={busy !== null}
                    >
                      Upgrade to Team
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Trial already used{usedPlan ? ` (${usedPlan})` : ""}.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="mt-10 space-y-6">
          <PlansBreakdown currentTier="free" />
          <CreditBalanceCard />
          <AiUsageMeter />
        </div>

      </div>
    </div>
  );
}
