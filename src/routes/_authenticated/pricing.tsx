import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2, ExternalLink, Minus, Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { usePlanContext } from "@/hooks/use-plan-context";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { getPaddleEnvironment } from "@/lib/paddle";
import { createCustomerPortalUrl } from "@/utils/payments.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing — Heartbeat" },
      { name: "description", content: "Choose the Heartbeat plan that fits your work." },
    ],
  }),
});

type Cycle = "month" | "year";

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function PricingPage() {
  const { user } = useAuth();
  const { tier, subscription, isActive, refetch } = useSubscription();
  const { plan, refetch: refetchPlan } = usePlanContext();
  const { openCheckout, loading } = usePaddleCheckout();
  const openPortal = useServerFn(createCustomerPortalUrl);
  const qc = useQueryClient();

  const [cycle, setCycle] = useState<Cycle>("month");
  const [seats, setSeats] = useState(2);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    toast.success("Payment received — activating your plan…");
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      await qc.invalidateQueries({ queryKey: ["plan-context"] });
      const { data } = await refetch();
      await refetchPlan();
      if (data || attempts >= 8) {
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        window.history.replaceState({}, "", url.toString());
        return;
      }
      setTimeout(tick, 1500);
    };
    tick();
  }, [qc, refetch, refetchPlan]);

  const proPrice = cycle === "month" ? 1000 : 9600;
  const teamPerSeat = cycle === "month" ? 1200 : 10000; // $10/seat/mo billed annually = $120/yr
  const teamYearTotalCents = seats * 12000; // $120/seat/yr
  const teamTotalCents = cycle === "month" ? seats * teamPerSeat : teamYearTotalCents;

  const trialEnd = plan?.trialEnd ? new Date(plan.trialEnd) : null;
  const trialing = trialEnd && trialEnd > new Date() && !isActive;

  const handleSubscribe = async (priceId: string, qty = 1) => {
    if (!user) return;
    try {
      await openCheckout({
        priceId,
        quantity: qty,
        customerEmail: user.email,
        customData: { userId: user.id },
        successUrl: `${window.location.origin}/pricing?checkout=success`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
    }
  };

  const handleManage = async () => {
    try {
      const { url } = await openPortal({ data: { environment: getPaddleEnvironment() } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open customer portal");
    }
  };

  const isCurrent = (id: "free" | "pro" | "team") => tier === id;

  const proFeatures = useMemo(
    () => [
      "Unlimited business accounts",
      "Unlimited calendar connections",
      "400 AI actions / month",
      "Meeting recording & summaries",
      "Pulse, weekly reports & insights",
      "Documents, automations & KPIs",
    ],
    [],
  );

  const teamFeatures = useMemo(
    () => [
      "Everything in Pro",
      "Shared accounts with your team",
      "400 AI actions / paid seat (pooled)",
      "Roles, mentions & shared inbox",
      "Viewers & commenters are always free",
      "Priority support",
    ],
    [],
  );

  return (
    <div>
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl">Plans & pricing</h1>
          <p className="mt-3 text-muted-foreground">
            Start free. Upgrade when you're ready for more.
          </p>

          {trialing && (
            <div className="mt-4 inline-block rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
              🎉 14-day Pro trial active until{" "}
              <strong>{trialEnd!.toLocaleDateString()}</strong> — add billing details to keep Pro features.
            </div>
          )}

          {isActive && subscription && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm">
              <span>
                Current plan: <strong className="capitalize">{tier}</strong>
                {plan && plan.tier === "team" && ` · ${plan.quantity} seats`}
                {subscription.cancel_at_period_end && " — cancels at period end"}
              </span>
              <Button variant="ghost" size="sm" onClick={handleManage}>
                Manage <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Billing cycle toggle */}
          <div className="mt-6 inline-flex items-center rounded-full border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setCycle("month")}
              className={`rounded-full px-4 py-1.5 text-sm transition ${cycle === "month" ? "bg-background shadow" : "text-muted-foreground"}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("year")}
              className={`rounded-full px-4 py-1.5 text-sm transition ${cycle === "year" ? "bg-background shadow" : "text-muted-foreground"}`}
            >
              Annual <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">save ~20%</span>
            </button>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {/* FREE */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Free</CardTitle>
              <CardDescription>The basics to stay organised.</CardDescription>
              <div className="mt-2">
                <span className="text-4xl font-semibold">$0</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {["1 user", "1 business account", "1 calendar connection", "20 AI actions / month", "No team sharing"].map(
                  (f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ),
                )}
              </ul>
              <Button variant="outline" className="w-full" disabled>
                {isCurrent("free") ? "Current plan" : "Included"}
              </Button>
            </CardContent>
          </Card>

          {/* PRO */}
          <Card className="border-primary shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Pro</CardTitle>
              <CardDescription>For solo operators.</CardDescription>
              <div className="mt-2">
                <span className="text-4xl font-semibold">{fmtMoney(proPrice)}</span>
                <span className="text-muted-foreground">
                  {cycle === "month" ? " /month" : " /year"}
                </span>
              </div>
              {cycle === "year" && (
                <p className="text-xs text-muted-foreground">≈ $8/mo · 2 months free vs monthly</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {isCurrent("pro") ? (
                <Button variant="outline" className="w-full" onClick={handleManage}>
                  Manage plan
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => handleSubscribe(cycle === "month" ? "pro_monthly" : "pro_yearly")}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isActive ? "Switch to Pro" : "Choose Pro"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* TEAM */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Team</CardTitle>
              <CardDescription>Pro features for your whole team.</CardDescription>
              <div className="mt-2">
                <span className="text-4xl font-semibold">{fmtMoney(teamPerSeat)}</span>
                <span className="text-muted-foreground">
                  {cycle === "month" ? " /seat/month" : " /seat/month billed annually"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Per seat · 2-seat minimum · viewers &amp; commenters free
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Paid seats</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setSeats((s) => Math.max(2, s - 1))}
                      disabled={seats <= 2}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-8 text-center tabular-nums">{seats}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setSeats((s) => Math.min(1000, s + 1))}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">
                    {cycle === "month" ? "Total / month" : "Total / year"}
                  </span>
                  <span className="font-semibold tabular-nums">{fmtMoney(teamTotalCents)}</span>
                </div>
              </div>
              <ul className="space-y-2 text-sm">
                {teamFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {isCurrent("team") ? (
                <Button variant="outline" className="w-full" onClick={handleManage}>
                  Manage plan
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSubscribe(cycle === "month" ? "team_monthly" : "team_yearly", seats)}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isActive ? (
                    `Switch to Team (${seats} seats)`
                  ) : (
                    `Start with ${seats} seats`
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Payments are processed by Paddle as merchant of record. Cancel anytime —{" "}
          <Link to="/privacy" className="underline">privacy</Link> &{" "}
          <Link to="/terms" className="underline">terms</Link>.
        </p>
      </div>
    </div>
  );
}
