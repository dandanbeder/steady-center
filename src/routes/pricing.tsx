import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, Users, Heart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { getPaddleEnvironment } from "@/lib/paddle";
import { getTrialEligibility, startFreeTrial } from "@/lib/trial.functions";
import {
  LIMITS,
  PRICING,
  SPACE_ACCOUNT_HELPER,
  TEAM_MIN_SEATS,
  TRIAL_DAYS,
  type Tier,
} from "@/lib/entitlements";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing, Heartbeat" },
      {
        name: "description",
        content:
          "One calm place for everything you're juggling, with AI built in. Free forever, Pro for everyday focus, Team for collaboration. AI included, viewers free.",
      },
      { property: "og:title", content: "Pricing, Heartbeat" },
      {
        property: "og:description",
        content:
          "One calm place for everything you're juggling, with AI built in. AI included, not a $9 add-on. Viewers & guests free.",
      },
    ],
  }),
});

type Cycle = "month" | "year";

function fmtUsd(cents: number): string {
  const v = cents / 100;
  return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const env = getPaddleEnvironment();
  const { tier: currentTier, isActive } = useSubscription();
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();

  const [cycle, setCycle] = useState<Cycle>("year");
  const [teamSeats, setTeamSeats] = useState<number>(TEAM_MIN_SEATS);
  const [busy, setBusy] = useState<string | null>(null);

  const trialFn = useServerFn(startFreeTrial);
  const eligibilityFn = useServerFn(getTrialEligibility);

  const eligibility = useQuery({
    queryKey: ["trial-eligibility", env, user?.id],
    enabled: !!user,
    queryFn: () => eligibilityFn({ data: { environment: env } }),
  });

  const trialEligible = !user || (eligibility.data?.eligible ?? true);

  // -- Prices come from the shared PRICING source of truth --
  const basicPrice = cycle === "year" ? PRICING.basic_yearly : PRICING.basic_monthly;
  const proPrice = cycle === "year" ? PRICING.pro_yearly : PRICING.pro_monthly;
  const teamPrice = cycle === "year" ? PRICING.team_yearly : PRICING.team_monthly;

  // Monthly equivalents for display
  const basicMonthlyEquivCents = cycle === "year" ? Math.round(PRICING.basic_yearly.amount / 12) : PRICING.basic_monthly.amount;
  const proMonthlyEquivCents = cycle === "year" ? Math.round(PRICING.pro_yearly.amount / 12) : PRICING.pro_monthly.amount;
  const teamMonthlyEquivCents = cycle === "year" ? Math.round(PRICING.team_yearly.amount / 12) : PRICING.team_monthly.amount;

  const basicAnnualSavingsPct = useMemo(() => {
    const m = PRICING.basic_monthly.amount * 12;
    const y = PRICING.basic_yearly.amount;
    return Math.round(((m - y) / m) * 100);
  }, []);

  const proAnnualSavingsPct = useMemo(() => {
    const m = PRICING.pro_monthly.amount * 12;
    const y = PRICING.pro_yearly.amount;
    return Math.round(((m - y) / m) * 100);
  }, []);

  const teamAnnualSavingsPct = useMemo(() => {
    const m = PRICING.team_monthly.amount * 12;
    const y = PRICING.team_yearly.amount;
    return Math.round(((m - y) / m) * 100);
  }, []);

  const startTrial = async () => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    setBusy("team");
    try {
      await trialFn({ data: { plan: "team", environment: env } });
      toast.success(`Your ${TRIAL_DAYS}-day Team trial has started.`);
      navigate({ to: "/today" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start trial";
      // If user is no longer eligible, fall through to checkout
      if (/TRIAL_ALREADY_USED|already used/i.test(msg)) {
        await beginCheckout("team");
        return;
      }
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const beginCheckout = async (plan: "basic" | "pro" | "team") => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    setBusy(plan);
    try {
      const priceId =
        plan === "basic"
          ? cycle === "year" ? "basic_yearly" : "basic_monthly"
          : plan === "pro"
            ? cycle === "year" ? "pro_yearly" : "pro_monthly"
            : cycle === "year" ? "team_yearly" : "team_monthly";
      const quantity = plan === "team" ? Math.max(teamSeats, TEAM_MIN_SEATS) : 1;
      await openCheckout({
        priceId,
        quantity,
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4EEE2", color: "#26382F" }}>
      {/* Header */}
      <header className="px-6 pt-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-serif text-xl" style={{ color: "#26382F" }}>
            <Heart className="h-5 w-5" style={{ color: "#C26B4D" }} />
            Heartbeat
          </Link>
          {user ? (
            <Link to="/today" className="text-sm underline-offset-4 hover:underline" style={{ color: "#26382F" }}>
              Open Heartbeat →
            </Link>
          ) : (
            <Link to="/login" className="text-sm underline-offset-4 hover:underline" style={{ color: "#26382F" }}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-12 pb-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl" style={{ color: "#26382F" }}>
            One calm place for everything you're juggling.
          </h1>
          <p className="mt-5 text-lg" style={{ color: "#26382F", opacity: 0.78 }}>
            For students, freelancers, creatives and business owners. Calendars, tasks, notes and Ask Heartbeat AI in one steady place. Free to start, pay only when you outgrow it.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm" style={{ color: "#26382F" }}>
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: "#C26B4D" }} />
              AI included, not a $9 add-on
            </span>
            <span className="hidden h-4 w-px md:block" style={{ backgroundColor: "#26382F", opacity: 0.18 }} />
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4" style={{ color: "#7C9B7F" }} />
              Viewers & guests are free, no seat
            </span>
          </div>
        </div>

        {/* Billing toggle */}
        <div className="mx-auto mt-10 flex w-fit items-center gap-1 rounded-full border p-1"
             style={{ backgroundColor: "#FBF8F0", borderColor: "rgba(38,56,47,0.12)" }}>
          <CycleButton active={cycle === "month"} onClick={() => setCycle("month")}>
            Monthly
          </CycleButton>
          <CycleButton active={cycle === "year"} onClick={() => setCycle("year")}>
            Annual
            <span className="ml-2 rounded-full px-2 py-0.5 text-xs"
                  style={{ backgroundColor: "#7C9B7F", color: "#FBF8F0" }}>
              Save 18%
            </span>
          </CycleButton>
        </div>
      </section>

      {/* Plan cards */}
      <section className="px-6 pb-16">
        <p className="mx-auto mb-6 max-w-3xl text-center text-sm" style={{ color: "#26382F", opacity: 0.78 }}>
          {SPACE_ACCOUNT_HELPER}
        </p>
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 xl:grid-cols-4">
          {/* Free */}
          <PlanCard
            name="Free"
            tagline="Try Heartbeat, free forever."
            priceMain={<span className="font-serif text-5xl">$0</span>}
            priceSub="forever"
            features={[
              "One calm space with calendar, tasks, notes and journal in one place",
              `A taste of AI, ${LIMITS.free.aiAllowanceCreditsPerSeat} credits per month`,
              `${LIMITS.free.maxBusinesses} account`,
            ]}
            note="Ask my notes unlocks on Standard"
            cta={
              <PlanCta
                tier="free"
                currentTier={currentTier}
                isActive={isActive}
                user={user}
                onPrimary={() => navigate({ to: user ? "/today" : "/login" })}
                label={user ? "Open Heartbeat" : "Start free"}
                loading={false}
                variant="ghost"
              />
            }
          />

          {/* Basic */}
          <PlanCard
            name="Basic"
            tagline="Two areas, one calm home."
            priceMain={
              <div className="flex flex-col leading-none">
                <span className="font-serif text-5xl">{fmtUsd(basicMonthlyEquivCents)}</span>
                <span className="text-sm font-medium" style={{ opacity: 0.7 }}>/mo</span>
              </div>
            }
            priceSub={
              cycle === "year"
                ? `Billed ${fmtUsd(PRICING.basic_yearly.amount)} yearly, save 18%`
                : "Billed monthly"
            }
            features={[
              `${LIMITS.basic.maxBusinesses} accounts within your space`,
              `${LIMITS.basic.aiAllowanceCreditsPerSeat} AI credits / month`,
              "Everything in Free, plus Reporting & Meetings",
              "Ask my notes, shown, unlocks on Standard",
            ]}
            cta={
              <PlanCta
                tier="basic"
                currentTier={currentTier}
                isActive={isActive}
                user={user}
                loading={busy === "basic" || checkoutLoading}
                onPrimary={() => beginCheckout("basic")}
                label={`Get Basic · ${fmtUsd(basicPrice.amount)}/${cycle === "year" ? "yr" : "mo"}`}
                variant="ghost"
              />
            }
          />

          {/* Standard - highlighted */}
          <PlanCard
            highlighted
            badge="Most popular"
            name="Standard"
            tagline="For everything you're juggling."
            priceMain={
              <div className="flex flex-col leading-none">
                <span className="font-serif text-5xl">{fmtUsd(proMonthlyEquivCents)}</span>
                <span className="text-sm font-medium" style={{ opacity: 0.7 }}>/mo</span>
              </div>
            }
            priceSub={
              cycle === "year"
                ? `Billed ${fmtUsd(PRICING.pro_yearly.amount)} yearly, save 18%`
                : "Billed monthly"
            }
            features={[
              `${LIMITS.pro.maxBusinesses} accounts within your space`,
              `${LIMITS.pro.aiAllowanceCreditsPerSeat} AI credits / month`,
              "Everything in Basic, plus Ask my notes (full)",
              "Top up AI credits anytime",
            ]}
            cta={
              <PlanCta
                tier="pro"
                currentTier={currentTier}
                isActive={isActive}
                user={user}
                loading={busy === "pro" || checkoutLoading}
                onPrimary={() => beginCheckout("pro")}
                label={`Get Standard · ${fmtUsd(proPrice.amount)}/${cycle === "year" ? "yr" : "mo"}`}
                variant="primary"
              />
            }
            footnote="Upgrade anytime, cancel anytime."
          />

          {/* Team */}
          <PlanCard
            name="Team"
            tagline="For teams that collaborate."
            priceMain={
              <div className="flex flex-col leading-none">
                <span className="font-serif text-5xl">{fmtUsd(teamMonthlyEquivCents)}</span>
                <span className="text-sm font-medium" style={{ opacity: 0.7 }}>/seat/mo</span>
              </div>
            }
            priceSub={
              cycle === "year"
                ? `Billed ${fmtUsd(PRICING.team_yearly.amount)}/seat yearly, save 18%`
                : `Billed monthly · ${TEAM_MIN_SEATS}-seat minimum`
            }
            features={[
              "Multiple accounts + shared team spaces",
              `${LIMITS.team.aiAllowanceCreditsPerSeat} AI credits per seat, pooled`,
              "Everything in Standard, plus Sharing, roles & team progress",
              "Viewers & guests free (no seat)",
            ]}
            extra={
              <div className="mt-4 rounded-lg border px-3 py-2.5 text-sm"
                   style={{ borderColor: "rgba(38,56,47,0.12)", backgroundColor: "rgba(124,155,127,0.08)" }}>
                <label className="flex items-center justify-between gap-3">
                  <span style={{ color: "#26382F" }}>Seats</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease seats"
                      onClick={() => setTeamSeats((n) => Math.max(TEAM_MIN_SEATS, n - 1))}
                      className="h-7 w-7 rounded-full border text-sm"
                      style={{ borderColor: "rgba(38,56,47,0.2)" }}
                    >–</button>
                    <input
                      type="number"
                      min={TEAM_MIN_SEATS}
                      max={1000}
                      value={teamSeats}
                      onChange={(e) =>
                        setTeamSeats(Math.max(TEAM_MIN_SEATS, Math.min(1000, Number(e.target.value) || TEAM_MIN_SEATS)))
                      }
                      className="w-14 rounded-md border bg-transparent px-2 py-1 text-center text-sm"
                      style={{ borderColor: "rgba(38,56,47,0.2)", color: "#26382F" }}
                    />
                    <button
                      type="button"
                      aria-label="Increase seats"
                      onClick={() => setTeamSeats((n) => Math.min(1000, n + 1))}
                      className="h-7 w-7 rounded-full border text-sm"
                      style={{ borderColor: "rgba(38,56,47,0.2)" }}
                    >+</button>
                  </div>
                </label>
                <p className="mt-2 text-xs" style={{ color: "#26382F", opacity: 0.7 }}>
                  Total: {fmtUsd(teamPrice.amount * teamSeats)} /{cycle === "year" ? "yr" : "mo"}
                </p>
              </div>
            }
            cta={
              <PlanCta
                tier="team"
                currentTier={currentTier}
                isActive={isActive}
                user={user}
                loading={busy === "team" || checkoutLoading}
                onPrimary={() => (trialEligible ? startTrial() : beginCheckout("team"))}
                label={
                  trialEligible
                    ? `Start ${TRIAL_DAYS}-day free trial`
                    : `Get Team · ${fmtUsd(teamPrice.amount * teamSeats)}/${cycle === "year" ? "yr" : "mo"}`
                }
                variant="secondary"
              />
            }
            footnote={trialEligible ? "No card required to start." : `Minimum ${TEAM_MIN_SEATS} seats.`}
          />
        </div>


        <p className="mx-auto mt-6 max-w-3xl text-center text-xs" style={{ color: "#26382F", opacity: 0.65 }}>
          Prices in USD. Local currency, taxes and VAT handled securely at checkout.
        </p>
      </section>

      {/* FAQ */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-serif text-3xl" style={{ color: "#26382F" }}>
            A few calm answers
          </h2>
          <div className="mt-8 space-y-4">
            <FaqItem q="What happens when my trial ends?">
              When a trial ends, you simply move to the Free plan, never locked out, nothing lost.
            </FaqItem>
            <FaqItem q="Can I cancel anytime?">
              Yes. Cancel anytime; you keep access until the end of your billing period.
            </FaqItem>
            <FaqItem q="What's an AI credit?">
              One credit is a small unit of AI use. Everyday actions cost a credit or a few; heavier ones cost more.
              Your plan includes a monthly allowance, and you can top up anytime, credits you buy never expire.
            </FaqItem>
            <FaqItem q="Can I switch plans later?">
              Yes, upgrade or downgrade anytime. Downgrades keep your data; extra items just become read-only until
              you upgrade again.
            </FaqItem>
            <FaqItem q="Do viewers and guests use a seat?">
              No. Viewers and commenters are free on Team, only paid roles (owner, admin, member) consume a seat.
            </FaqItem>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8 text-center text-xs"
              style={{ borderColor: "rgba(38,56,47,0.12)", color: "#26382F", opacity: 0.7 }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <span>© {new Date().getFullYear()} FlightMed (PTY) Ltd.</span>
          <span aria-hidden>·</span>
          <Link to="/terms" className="hover:underline">Terms</Link>
          <Link to="/privacy" className="hover:underline">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}

function CycleButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2",
      )}
      style={
        active
          ? { backgroundColor: "#26382F", color: "#FBF8F0" }
          : { backgroundColor: "transparent", color: "#26382F" }
      }
    >
      {children}
    </button>
  );
}

type PlanCardProps = {
  name: string;
  tagline: string;
  priceMain: React.ReactNode;
  priceSub: string;
  features: string[];
  cta: React.ReactNode;
  note?: string;
  extra?: React.ReactNode;
  footnote?: string;
  highlighted?: boolean;
  badge?: string;
};

function PlanCard({
  name, tagline, priceMain, priceSub, features, cta, note, extra, footnote, highlighted, badge,
}: PlanCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-7 transition-shadow",
        highlighted ? "shadow-lg" : "shadow-sm",
      )}
      style={{
        backgroundColor: "#FBF8F0",
        borderColor: highlighted ? "#C26B4D" : "rgba(38,56,47,0.14)",
        borderWidth: highlighted ? 2 : 1,
      }}
    >
      {badge ? (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: "#C26B4D", color: "#FBF8F0" }}
        >
          {badge}
        </span>
      ) : null}

      <div>
        <h3 className="font-serif text-2xl" style={{ color: "#26382F" }}>{name}</h3>
        <p className="mt-1 text-sm" style={{ color: "#26382F", opacity: 0.7 }}>{tagline}</p>
      </div>

      <div className="mt-6 min-h-[4.5rem]" style={{ color: "#26382F" }}>
        {priceMain}
      </div>
      <p className="mt-1 text-xs" style={{ color: "#26382F", opacity: 0.7 }}>{priceSub}</p>

      <ul className="mt-6 space-y-3 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm" style={{ color: "#26382F" }}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#7C9B7F" }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {note ? (
        <p className="mt-3 text-xs italic" style={{ color: "#26382F", opacity: 0.65 }}>{note}</p>
      ) : null}

      {extra}

      <div className="mt-7">{cta}</div>
      {footnote ? (
        <p className="mt-2 text-center text-xs" style={{ color: "#26382F", opacity: 0.6 }}>{footnote}</p>
      ) : null}
    </div>
  );
}

function PlanCta({
  tier, currentTier, isActive, user, loading, onPrimary, label, variant,
}: {
  tier: Tier;
  currentTier: Tier;
  isActive: boolean;
  user: { id: string } | null;
  loading: boolean;
  onPrimary: () => void;
  label: string;
  variant: "primary" | "secondary" | "ghost";
}) {
  const isYour = !!user && currentTier === tier && (tier === "free" || isActive);

  if (isYour) {
    return (
      <Link
        to="/billing"
        className="block w-full rounded-lg border py-2.5 text-center text-sm font-medium transition-colors"
        style={{
          borderColor: "rgba(38,56,47,0.2)",
          color: "#26382F",
          backgroundColor: "transparent",
        }}
      >
        Your plan
      </Link>
    );
  }

  const styles =
    variant === "primary"
      ? { backgroundColor: "#C26B4D", color: "#FBF8F0", borderColor: "#C26B4D" }
      : variant === "secondary"
        ? { backgroundColor: "#26382F", color: "#FBF8F0", borderColor: "#26382F" }
        : { backgroundColor: "transparent", color: "#26382F", borderColor: "rgba(38,56,47,0.3)" };

  return (
    <Button
      type="button"
      onClick={onPrimary}
      disabled={loading}
      className="w-full border py-5 text-sm font-medium"
      style={styles}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details
      className="group rounded-xl border p-5 transition-colors open:shadow-sm"
      style={{ backgroundColor: "#FBF8F0", borderColor: "rgba(38,56,47,0.12)" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-medium"
        style={{ color: "#26382F" }}
      >
        {q}
        <span className="text-xl transition-transform group-open:rotate-45" style={{ color: "#C26B4D" }}>
          +
        </span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: "#26382F", opacity: 0.8 }}>
        {children}
      </p>
    </details>
  );
}
