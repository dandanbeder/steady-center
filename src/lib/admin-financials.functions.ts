/**
 * Super-admin "Financials & Analytics" read.
 * One curated payload, never user content. Pulls from rollups + small
 * targeted aggregates only; no full table scans.
 *
 * Cost assumptions for contribution margin (per user spec):
 *   - Paddle + FX: 7% of gross revenue
 *   - Infra: $0 per paying user (tweak below as needed)
 *   - True AI cost: from ai_usage_daily / ai_usage_account_totals (micros)
 */
import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TOPUP_PACKS } from "@/lib/topup-packs";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

// Cost / revenue assumptions
const PADDLE_FX_RATE = 0.07; // 7% of gross revenue
const INFRA_CENTS_PER_PAYING_USER_PER_MONTH = 0;

// Map: credits -> cents (from TOPUP_PACKS) so we can value credit_ledger top-ups
const TOPUP_PRICE_BY_CREDITS = new Map<number, number>(
  TOPUP_PACKS.map((p) => [p.credits, p.amountCents]),
);

type SnapRow = {
  day: string;
  free_users: number;
  pro_users: number;
  team_users: number;
  trialing: number;
  past_due: number;
  canceled: number;
  team_seats_sold: number;
  mrr_pro_cents: number;
  mrr_team_cents: number;
  mrr_total_cents: number;
  monthly_subs: number;
  annual_subs: number;
};

type DailyRow = {
  day: string;
  signups: number;
  ai_actions: number;
  trial_started: number;
  trial_converted: number;
  subscription_canceled: number;
  dau: number;
  wau: number;
  mau: number;
};

export type FinancialsSummary = {
  asOf: string;
  headline: {
    mrrCents: number;
    arrCents: number;
    arpuCents: number;
    payingCustomers: number;
    /** Headline contribution margin: revenue − (AI cost + Paddle/FX + infra) */
    contributionMarginCents: number;
    contributionMarginPct: number;
  };
  revenueByPlan: Array<{
    plan: "pro" | "team";
    users: number;
    seats?: number;
    mrrCents: number;
    aiCostCents: number;
    paddleCostCents: number;
    infraCostCents: number;
    marginCents: number;
    marginPct: number;
  }>;
  billingMix: { monthly: number; annual: number };
  mrrMovement30d: {
    newCents: number;
    expansionCents: number;
    contractionCents: number;
    churnedCents: number;
    netCents: number;
    note: string;
  };
  topups: {
    revenue30dCents: number;
    revenueAllTimeCents: number;
    purchases30d: number;
    purchasesAllTime: number;
    creditsSold30d: number;
  };
  conversion: {
    trialStarted30d: number;
    trialConverted30d: number;
    trialConversionRate: number;
    logoChurnRate30d: number;
    revenueChurnRate30d: number;
    ltvEstimateCents: number;
  };
  cash: {
    collected30dCents: number;
    aiBurn30dMicros: number;
    aiBurnAllTimeMicros: number;
    kittyRemainingMicros: number;
    runwayDays: number | null;
    payoutLagNote: string;
  };
  users: {
    total: number;
    new7d: number;
    new30d: number;
    dau: number;
    wau: number;
    mau: number;
    stickiness: number;
    planDistribution: { free: number; pro: number; team: number };
  };
  funnel30d: Array<{ stage: string; count: number; rate: number }>;
  trends: {
    mrrSeries: Array<{ day: string; mrrCents: number }>;
    signupsSeries: Array<{ day: string; signups: number }>;
    aiActionsSeries: Array<{ day: string; actions: number }>;
    activeSeries: Array<{ day: string; dau: number; wau: number; mau: number }>;
  };
};

export const adminFinancialsSummary = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<FinancialsSummary> => {
    await requirePlatformAdmin(context.userId);

    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const d30Date = new Date(now.getTime() - 30 * 86_400_000);
    const d30 = d30Date.toISOString();
    const d30Day = d30Date.toISOString().slice(0, 10);
    const d90Day = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);

    const [
      snapsRes,
      dailyRes,
      kittyRes,
      ledgerRes,
      ledgerAllRes,
      totUsers,
      new7,
      new30,
    ] = await Promise.all([
      supabaseAdmin
        .from("analytics_subscription_snapshots")
        .select(
          "day, free_users, pro_users, team_users, trialing, past_due, canceled, team_seats_sold, mrr_pro_cents, mrr_team_cents, mrr_total_cents, monthly_subs, annual_subs",
        )
        .gte("day", d90Day)
        .order("day", { ascending: true }),
      supabaseAdmin
        .from("analytics_daily_metrics")
        .select(
          "day, signups, ai_actions, trial_started, trial_converted, subscription_canceled, dau, wau, mau",
        )
        .gte("day", d90Day)
        .order("day", { ascending: true }),
      // Reuse the existing economics RPC for kitty + AI cost rollup
      supabaseAdmin.rpc("admin_ai_economics_summary"),
      // Top-up ledger entries in 30d
      supabaseAdmin
        .from("credit_ledger")
        .select("delta, source, created_at")
        .eq("source", "topup")
        .gte("created_at", d30),
      // All-time top-up count + credits (head=false for sum on client)
      supabaseAdmin
        .from("credit_ledger")
        .select("delta", { count: "exact" })
        .eq("source", "topup"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", d7),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", d30),
    ]);

    const snaps = (snapsRes.data ?? []) as SnapRow[];
    const daily = (dailyRes.data ?? []) as DailyRow[];
    const econ = (kittyRes.data ?? null) as null | {
      totals_30d?: { cost_micros: number };
      kitty?: {
        consumed_micros: number;
        remaining_micros: number;
        runway_days: number | null;
      };
      revenue?: { topup_revenue_30d_cents: number; topup_revenue_alltime_cents: number };
    };

    // ----- Latest snapshot drives "now" numbers
    const latest = snaps.at(-1);
    const prevMonth = snaps.find((s) => s.day <= d30Day) ?? snaps[0];

    const proUsers = latest?.pro_users ?? 0;
    const teamUsers = latest?.team_users ?? 0;
    const teamSeats = latest?.team_seats_sold ?? 0;
    const paying = proUsers + teamUsers;
    const mrrPro = Number(latest?.mrr_pro_cents ?? 0);
    const mrrTeam = Number(latest?.mrr_team_cents ?? 0);
    const mrrTotal = Number(latest?.mrr_total_cents ?? 0);
    const arr = mrrTotal * 12;
    const arpu = paying > 0 ? mrrTotal / paying : 0;

    // ----- AI cost split: prorate by share of MRR (good-enough heuristic; we don't tag events per plan)
    const aiCost30dMicros = Number(econ?.totals_30d?.cost_micros ?? 0);
    const aiCost30dCents = aiCost30dMicros / 10_000;
    const proShare = mrrTotal > 0 ? mrrPro / mrrTotal : 0;
    const teamShare = mrrTotal > 0 ? mrrTeam / mrrTotal : 0;

    const buildPlanRow = (
      plan: "pro" | "team",
      users: number,
      planMrr: number,
      share: number,
      seats?: number,
    ) => {
      const aiCost = aiCost30dCents * share;
      const paddleCost = planMrr * PADDLE_FX_RATE;
      const infraCost = users * INFRA_CENTS_PER_PAYING_USER_PER_MONTH;
      const margin = planMrr - aiCost - paddleCost - infraCost;
      return {
        plan,
        users,
        seats,
        mrrCents: Math.round(planMrr),
        aiCostCents: Math.round(aiCost),
        paddleCostCents: Math.round(paddleCost),
        infraCostCents: Math.round(infraCost),
        marginCents: Math.round(margin),
        marginPct: planMrr > 0 ? margin / planMrr : 0,
      };
    };

    const revenueByPlan = [
      buildPlanRow("pro", proUsers, mrrPro, proShare),
      buildPlanRow("team", teamUsers, mrrTeam, teamShare, teamSeats),
    ];

    const totalRevenue = mrrTotal;
    const totalVariableCost =
      aiCost30dCents +
      totalRevenue * PADDLE_FX_RATE +
      paying * INFRA_CENTS_PER_PAYING_USER_PER_MONTH;
    const contributionMargin = totalRevenue - totalVariableCost;

    // ----- MRR movement (30-day delta, approximate)
    const mrr30dAgo = Number(prevMonth?.mrr_total_cents ?? mrrTotal);
    const netMovement = mrrTotal - mrr30dAgo;
    // Approximate split from new signups vs canceled events in 30d
    const trialConvertedSum = daily
      .filter((d) => d.day >= d30Day)
      .reduce((s, d) => s + (d.trial_converted ?? 0), 0);
    const canceledSum = daily
      .filter((d) => d.day >= d30Day)
      .reduce((s, d) => s + (d.subscription_canceled ?? 0), 0);
    const avgArpu = paying > 0 ? mrrTotal / paying : 1000; // fallback $10
    const newCents = Math.round(trialConvertedSum * avgArpu);
    const churnedCents = Math.round(canceledSum * avgArpu);
    const expansionCents = Math.max(0, netMovement - newCents + churnedCents);
    const contractionCents = Math.max(0, -netMovement + newCents - churnedCents);

    // ----- Top-up revenue (value credit_ledger topup rows via TOPUP_PACKS)
    const topupRows = (ledgerRes.data ?? []) as Array<{ delta: number }>;
    let topupRev30d = 0;
    let creditsSold30d = 0;
    for (const r of topupRows) {
      const credits = Number(r.delta ?? 0);
      creditsSold30d += credits;
      const cents = TOPUP_PRICE_BY_CREDITS.get(credits);
      if (cents) topupRev30d += cents;
    }
    const topupRevAllTime = Number(econ?.revenue?.topup_revenue_alltime_cents ?? 0);

    // ----- Conversion & churn
    const trialStarted30d = daily
      .filter((d) => d.day >= d30Day)
      .reduce((s, d) => s + (d.trial_started ?? 0), 0);
    const trialConvRate = trialStarted30d > 0 ? trialConvertedSum / trialStarted30d : 0;
    const logoChurn = paying > 0 ? canceledSum / paying : 0;
    const revenueChurn = mrrTotal > 0 ? churnedCents / mrrTotal : 0;
    const monthlyChurnForLtv = logoChurn > 0 ? logoChurn : 1 / 24;
    const ltvEst = arpu / monthlyChurnForLtv;

    // ----- Funnel (30d)
    const signups30d = daily
      .filter((d) => d.day >= d30Day)
      .reduce((s, d) => s + (d.signups ?? 0), 0);
    const funnel = [
      { stage: "Signup", count: signups30d, rate: 1 },
      {
        stage: "Trial started",
        count: trialStarted30d,
        rate: signups30d ? trialStarted30d / signups30d : 0,
      },
      {
        stage: "Paid",
        count: trialConvertedSum,
        rate: signups30d ? trialConvertedSum / signups30d : 0,
      },
    ];

    // ----- Trends (90d)
    const mrrSeries = snaps.map((s) => ({ day: s.day, mrrCents: Number(s.mrr_total_cents) }));
    const signupsSeries = daily.map((d) => ({ day: d.day, signups: d.signups ?? 0 }));
    const aiActionsSeries = daily.map((d) => ({ day: d.day, actions: d.ai_actions ?? 0 }));
    const activeSeries = daily.map((d) => ({
      day: d.day,
      dau: d.dau ?? 0,
      wau: d.wau ?? 0,
      mau: d.mau ?? 0,
    }));

    const latestActive = daily.at(-1);
    const stickiness = latestActive?.mau ? latestActive.dau / latestActive.mau : 0;

    return {
      asOf: now.toISOString(),
      headline: {
        mrrCents: mrrTotal,
        arrCents: arr,
        arpuCents: Math.round(arpu),
        payingCustomers: paying,
        contributionMarginCents: Math.round(contributionMargin),
        contributionMarginPct: totalRevenue > 0 ? contributionMargin / totalRevenue : 0,
      },
      revenueByPlan,
      billingMix: {
        monthly: latest?.monthly_subs ?? 0,
        annual: latest?.annual_subs ?? 0,
      },
      mrrMovement30d: {
        newCents,
        expansionCents,
        contractionCents,
        churnedCents,
        netCents: netMovement,
        note:
          "Approximate split: new ≈ trial conversions × ARPU, churned ≈ cancellations × ARPU. Expansion/contraction back out of net delta.",
      },
      topups: {
        revenue30dCents: topupRev30d,
        revenueAllTimeCents: topupRevAllTime,
        purchases30d: topupRows.length,
        purchasesAllTime: ledgerAllRes.count ?? 0,
        creditsSold30d,
      },
      conversion: {
        trialStarted30d,
        trialConverted30d: trialConvertedSum,
        trialConversionRate: trialConvRate,
        logoChurnRate30d: logoChurn,
        revenueChurnRate30d: revenueChurn,
        ltvEstimateCents: Math.round(ltvEst),
      },
      cash: {
        collected30dCents: Math.round(mrrTotal + topupRev30d),
        aiBurn30dMicros: aiCost30dMicros,
        aiBurnAllTimeMicros: Number(econ?.kitty?.consumed_micros ?? 0),
        kittyRemainingMicros: Number(econ?.kitty?.remaining_micros ?? 0),
        runwayDays: econ?.kitty?.runway_days ?? null,
        payoutLagNote:
          "Paddle settles ~7 business days after capture. Collected ≈ MRR + 30-day top-ups; payouts trail by the settlement window.",
      },
      users: {
        total: totUsers.count ?? 0,
        new7d: new7.count ?? 0,
        new30d: new30.count ?? 0,
        dau: latestActive?.dau ?? 0,
        wau: latestActive?.wau ?? 0,
        mau: latestActive?.mau ?? 0,
        stickiness,
        planDistribution: {
          free: latest?.free_users ?? 0,
          pro: proUsers,
          team: teamUsers,
        },
      },
      funnel30d: funnel,
      trends: { mrrSeries, signupsSeries, aiActionsSeries, activeSeries },
    };
  });
