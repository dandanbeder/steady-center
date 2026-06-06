import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2, ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
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

type Plan = {
  id: "free" | "pro" | "team";
  name: string;
  priceLabel: string;
  priceId?: string;
  description: string;
  features: string[];
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    description: "The basics to stay organised.",
    features: ["1 business account", "Tasks, notes & calendar", "Limited AI usage"],
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "$10",
    priceId: "pro_monthly",
    description: "Everything you need for solo work.",
    features: [
      "Unlimited business accounts",
      "Meetings recording & summaries",
      "Daily pulse & weekly reports",
      "Full AI assistant",
    ],
    highlight: true,
  },
  {
    id: "team",
    name: "Team",
    priceLabel: "$35",
    priceId: "team_monthly",
    description: "Pro features for your whole team.",
    features: [
      "Everything in Pro",
      "Shared accounts & members",
      "Mentions & shared inbox",
      "Priority support",
    ],
  },
];

function PricingPage() {
  const { user } = useAuth();
  const { tier, subscription, isActive } = useSubscription();
  const { openCheckout, loading } = usePaddleCheckout();
  const openPortal = useServerFn(createCustomerPortalUrl);

  const handleSubscribe = async (plan: Plan) => {
    if (!plan.priceId || !user) return;
    try {
      await openCheckout({
        priceId: plan.priceId,
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

  return (
    <div>
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl">Plans & pricing</h1>
          <p className="mt-3 text-muted-foreground">
            Start free. Upgrade when you're ready for more.
          </p>
          {isActive && subscription && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm">
              <span>
                Current plan: <strong className="capitalize">{tier}</strong>
                {subscription.cancel_at_period_end && " — cancels at period end"}
              </span>
              <Button variant="ghost" size="sm" onClick={handleManage}>
                Manage <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = tier === plan.id;
            return (
              <Card
                key={plan.id}
                className={plan.highlight ? "border-primary shadow-lg" : undefined}
              >
                <CardHeader>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-2">
                    <span className="text-4xl font-semibold">{plan.priceLabel}</span>
                    {plan.id !== "free" && (
                      <span className="text-muted-foreground"> /month</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="pt-2">
                    {plan.id === "free" ? (
                      <Button variant="outline" className="w-full" disabled>
                        {tier === "free" ? "Current plan" : "Included"}
                      </Button>
                    ) : isCurrent ? (
                      <Button variant="outline" className="w-full" onClick={handleManage}>
                        Manage plan
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => handleSubscribe(plan)}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isActive ? (
                          `Switch to ${plan.name}`
                        ) : (
                          `Choose ${plan.name}`
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
