// Super-admin analytics readers. All gated server-side by requirePlatformAdmin().
// Reads pre-aggregated rollup tables (analytics_daily_metrics, analytics_subscription_snapshots)
// + live aggregate queries against subscriptions/profiles for "today" cards.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

// Cents — must match src/lib/entitlements.ts PRICING and the SQL refresher.
const PRICE_PRO_MONTH = 1000;
const PRICE_PRO_YEAR = 9600;
const PRICE_TEAM_MONTH = 1200;
const PRICE_TEAM_YEAR = 12000;

const DateRange = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .default({});

type DateRangeInput = { from?: string; to?: string } | undefined;

function rangeDays(r: { from?: string; to?: string }, defaultDays = 30) {
  const to = r.to ? new Date(r.to) : new Date();
  const from = r.from ? new Date(r.from) : new Date(to.getTime() - defaultDays * 86_400_000);
  return { from, to, days: Math.max(1, Math.round((+to - +from) / 86_400_000)) };
}

// ============= OVERVIEW =============
export const analyticsOverview = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const d7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();

    const [totUsers, paying, signups7, signups30, signupsToday, totAccounts, latestSnap, last30Days] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("subscriptions")
          .select("user_id", { count: "exact", head: true })
          .eq("environment", "live")
          .in("status", ["active", "trialing", "past_due"]),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d7),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d30),
        supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfToday),
        supabaseAdmin.from("businesses").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("analytics_subscription_snapshots")
          .select("*")
          .order("day", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("analytics_daily_metrics")
          .select("day, dau, wau, mau, signups, logins")
          .order("day", { ascending: false })
          .limit(30),
      ]);

    // 30d trial conversion / churn from events
    const [tStarted, tConverted, canceled] = await Promise.all([
      supabaseAdmin
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("type", "trial_started")
        .gte("created_at", d30),
      supabaseAdmin
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("type", "trial_converted")
        .gte("created_at", d30),
      supabaseAdmin
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("type", "subscription_canceled")
        .gte("created_at", d30),
    ]);

    const trialConversionRate = (tStarted.count ?? 0) > 0
      ? (tConverted.count ?? 0) / (tStarted.count as number)
      : 0;

    const payingCount = paying.count ?? 0;
    const churnRate30d = payingCount > 0 ? (canceled.count ?? 0) / payingCount : 0;
    const mrr = Number(latestSnap.data?.mrr_total_cents ?? 0);
    const arr = mrr * 12;
    const arpu = payingCount > 0 ? mrr / payingCount : 0;

    const latest = last30Days.data?.[0];
    const sparkline = (last30Days.data ?? [])
      .slice()
      .reverse()
      .map((r) => ({ day: r.day, dau: r.dau, signups: r.signups }));

    return {
      totalUsers: totUsers.count ?? 0,
      totalAccounts: totAccounts.count ?? 0,
      payingCustomers: payingCount,
      signupsToday: signupsToday.count ?? 0,
      signups7d: signups7.count ?? 0,
      signups30d: signups30.count ?? 0,
      dau: latest?.dau ?? 0,
      wau: latest?.wau ?? 0,
      mau: latest?.mau ?? 0,
      stickiness: (latest?.mau ?? 0) > 0 ? (latest!.dau ?? 0) / latest!.mau! : 0,
      mrrCents: mrr,
      arrCents: arr,
      arpuCents: arpu,
      trialConversionRate,
      churnRate30d,
      sparkline,
      paddleNote:
        "Paddle is the source of truth for revenue. MRR is computed from synced subscription rows.",
    };
  });

// ============= BY PLAN =============
export const analyticsByPlan = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: snap } = await supabaseAdmin
      .from("analytics_subscription_snapshots")
      .select("*")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) return { rows: [], totals: null };

    const total =
      Number(snap.free_users) + Number(snap.pro_users) + Number(snap.team_users);
    const rows = [
      {
        plan: "free" as const,
        users: Number(snap.free_users),
        pct: total ? snap.free_users / total : 0,
        mrrCents: 0,
      },
      {
        plan: "pro" as const,
        users: Number(snap.pro_users),
        pct: total ? snap.pro_users / total : 0,
        mrrCents: Number(snap.mrr_pro_cents),
      },
      {
        plan: "team" as const,
        users: Number(snap.team_users),
        pct: total ? snap.team_users / total : 0,
        mrrCents: Number(snap.mrr_team_cents),
        seats: Number(snap.team_seats_sold),
      },
    ];
    return {
      rows,
      totals: {
        trialing: Number(snap.trialing),
        past_due: Number(snap.past_due),
        canceled: Number(snap.canceled),
        team_seats_sold: Number(snap.team_seats_sold),
        mrr_total_cents: Number(snap.mrr_total_cents),
      },
    };
  });

// ============= REVENUE (time series) =============
export const analyticsRevenue = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { from } = rangeDays(data ?? {}, 90);
    const { data: snaps } = await supabaseAdmin
      .from("analytics_subscription_snapshots")
      .select("day, mrr_pro_cents, mrr_team_cents, mrr_total_cents, monthly_subs, annual_subs, pro_users, team_users")
      .gte("day", from.toISOString().slice(0, 10))
      .order("day", { ascending: true });

    const series = (snaps ?? []).map((s, i) => {
      const prev = i > 0 ? snaps![i - 1] : null;
      const delta = prev ? Number(s.mrr_total_cents) - Number(prev.mrr_total_cents) : 0;
      return {
        day: s.day,
        mrrCents: Number(s.mrr_total_cents),
        proMrrCents: Number(s.mrr_pro_cents),
        teamMrrCents: Number(s.mrr_team_cents),
        netNewCents: delta,
        monthly: Number(s.monthly_subs),
        annual: Number(s.annual_subs),
      };
    });

    const latest = series.at(-1);
    const paying = latest ? Number((snaps?.at(-1)?.pro_users ?? 0)) + Number((snaps?.at(-1)?.team_users ?? 0)) : 0;
    const arpu = latest && paying > 0 ? latest.mrrCents / paying : 0;

    // AI revenue placeholder — wire to credits invoicing when implemented.
    return {
      series,
      arpuCents: arpu,
      monthlyVsAnnual: {
        monthly: latest?.monthly ?? 0,
        annual: latest?.annual ?? 0,
      },
      ltvEstimateCents:
        // LTV ≈ ARPU / monthly churn; churn 0 fallback to 24-month default
        (arpu > 0 ? arpu * 24 : 0),
      aiRevenueCents: 0,
      reconciliationNote:
        "Numbers are computed from synced subscription rows. Reconcile against Paddle for invoiced revenue and tax.",
    };
  });

// ============= GROWTH FUNNEL =============
export const analyticsFunnel = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { from, to } = rangeDays(data ?? {}, 30);
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    const [signups, activated, trialed, paid] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
      // "activated" = onboarding completed
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .not("onboarding_completed_at", "is", null),
      supabaseAdmin
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("type", "trial_started")
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
      supabaseAdmin
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("type", "trial_converted")
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
    ]);

    const s = signups.count ?? 0;
    const a = activated.count ?? 0;
    const t = trialed.count ?? 0;
    const p = paid.count ?? 0;
    return {
      stages: [
        { stage: "Signups", count: s, rate: 1 },
        { stage: "Activated", count: a, rate: s ? a / s : 0 },
        { stage: "Trial started", count: t, rate: s ? t / s : 0 },
        { stage: "Paid", count: p, rate: s ? p / s : 0 },
      ],
      timeToConvertNote:
        "Time-to-convert needs per-user signup→paid timestamps; populated as users move through the funnel.",
    };
  });

// ============= ENGAGEMENT =============
export const analyticsEngagement = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { from } = rangeDays(data ?? {}, 30);
    const fromDay = from.toISOString().slice(0, 10);

    const [{ data: metrics }, calConn, meetings, aiUsers, sharers, totUsers] = await Promise.all([
      supabaseAdmin
        .from("analytics_daily_metrics")
        .select("day, dau, wau, mau")
        .gte("day", fromDay)
        .order("day", { ascending: true }),
      supabaseAdmin
        .from("calendars")
        .select("owner_id")
        .neq("provider", "manual"),
      supabaseAdmin.from("meetings").select("owner_id"),
      supabaseAdmin.from("ai_usage").select("user_id"),
      supabaseAdmin.from("shares").select("granted_by"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    ]);

    const total = totUsers.count ?? 0;
    const uniq = (rows: { [k: string]: unknown }[] | null, key: string) =>
      new Set((rows ?? []).map((r) => r[key]).filter(Boolean)).size;

    const calUsers = uniq(calConn.data ?? null, "owner_id");
    const meetingUsers = uniq(meetings.data ?? null, "owner_id");
    const aiUsersCount = uniq(aiUsers.data ?? null, "user_id");
    const sharingUsers = uniq(sharers.data ?? null, "granted_by");

    const latest = metrics?.at(-1);
    return {
      activeTrend: metrics ?? [],
      stickiness: latest && latest.mau ? latest.dau / latest.mau : 0,
      adoption: {
        calendar_sync: total ? calUsers / total : 0,
        meetings: total ? meetingUsers / total : 0,
        ai: total ? aiUsersCount / total : 0,
        sharing: total ? sharingUsers / total : 0,
      },
      adoptionCounts: { calendar_sync: calUsers, meetings: meetingUsers, ai: aiUsersCount, sharing: sharingUsers, total_users: total },
      retentionNote:
        "Week-over-week cohort retention table coming in v2 — needs per-user weekly active flag.",
    };
  });

// ============= AI ECONOMICS =============
export const analyticsAi = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { from } = rangeDays(data ?? {}, 30);

    const { data: usage } = await supabaseAdmin
      .from("ai_usage")
      .select("user_id, actions, cents, tokens, month")
      .gte("updated_at", from.toISOString());

    const totalActions = (usage ?? []).reduce((s, r) => s + (r.actions ?? 0), 0);
    const totalCostCents = (usage ?? []).reduce((s, r) => s + (r.cents ?? 0), 0);
    const totalTokens = (usage ?? []).reduce((s, r) => s + (r.tokens ?? 0), 0);

    // Plan attribution via latest subscription
    const userIds = Array.from(new Set((usage ?? []).map((u) => u.user_id))).filter(Boolean) as string[];
    let actionsByPlan: Record<string, number> = { free: 0, pro: 0, team: 0 };
    if (userIds.length) {
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id, product_id, status, current_period_end, created_at")
        .in("user_id", userIds)
        .eq("environment", "live")
        .order("created_at", { ascending: false });
      const latestByUser = new Map<string, { product_id: string; status: string; current_period_end: string | null }>();
      for (const s of subs ?? []) {
        if (!latestByUser.has(s.user_id as string)) latestByUser.set(s.user_id as string, s as any);
      }
      for (const u of usage ?? []) {
        const sub = latestByUser.get(u.user_id as string);
        let plan: "free" | "pro" | "team" = "free";
        if (sub) {
          const active =
            ["active", "trialing", "past_due"].includes(sub.status) &&
            (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
          if (active) plan = sub.product_id === "team_plan" ? "team" : sub.product_id === "pro_plan" ? "pro" : "free";
        }
        actionsByPlan[plan] += u.actions ?? 0;
      }
    }

    return {
      totalActions,
      totalCostCents,
      totalTokens,
      actionsByPlan,
      revenueCents: 0, // not billed yet
      marginCents: -totalCostCents,
      note: "AI revenue is 0 until credit packs ship. Cost is OpenAI/Anthropic spend captured in ai_usage.",
    };
  });

// ============= CHURN & RISK =============
export const analyticsChurnRisk = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: DateRangeInput) => DateRange.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { from } = rangeDays(data ?? {}, 30);
    const fromISO = from.toISOString();
    const fourteenDays = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const [cancellations, paying, trialEnding, paymentFailed, totUsers, recentLogins] =
      await Promise.all([
        supabaseAdmin
          .from("analytics_events")
          .select("created_at")
          .eq("type", "subscription_canceled")
          .gte("created_at", fromISO)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("subscriptions")
          .select("user_id", { count: "exact", head: true })
          .eq("environment", "live")
          .in("status", ["active", "trialing", "past_due"]),
        supabaseAdmin
          .from("subscriptions")
          .select("user_id", { count: "exact", head: true })
          .eq("environment", "live")
          .eq("status", "trialing")
          .lte("current_period_end", soon),
        supabaseAdmin
          .from("subscriptions")
          .select("user_id", { count: "exact", head: true })
          .eq("environment", "live")
          .eq("status", "past_due"),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("login_history")
          .select("user_id")
          .gte("occurred_at", fourteenDays),
      ]);

    // Group cancellations by day
    const byDay = new Map<string, number>();
    for (const c of cancellations.data ?? []) {
      const d2 = (c.created_at as string).slice(0, 10);
      byDay.set(d2, (byDay.get(d2) ?? 0) + 1);
    }
    const cancellationsTrend = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));

    const activeRecently = new Set((recentLogins.data ?? []).map((r) => r.user_id));
    const inactive = (totUsers.count ?? 0) - activeRecently.size;

    const payingCount = paying.count ?? 0;
    return {
      cancellationsTrend,
      churnRate: payingCount > 0 ? (cancellations.data?.length ?? 0) / payingCount : 0,
      atRisk: {
        trial_ending_3d: trialEnding.count ?? 0,
        payment_failed: paymentFailed.count ?? 0,
        inactive_14d: Math.max(0, inactive),
      },
    };
  });

// ============= SEGMENT USERS (click-through + CSV) =============
const Segment = z.enum([
  "free",
  "pro",
  "team",
  "trialing",
  "past_due",
  "canceled",
  "trial_ending",
  "inactive_14d",
  "all",
  "active",
  "suspended",
  "scheduled_deletion",
  "superadmin",
]);
export type AnalyticsSegment = z.infer<typeof Segment>;

export const analyticsSegmentUsers = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { segment: AnalyticsSegment; limit?: number }) =>
    z.object({ segment: Segment, limit: z.number().int().min(1).max(5000).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const limit = data.limit ?? 1000;

    // Build candidate user_id list
    let userIds: string[] = [];
    if (["pro", "team", "trialing", "past_due", "canceled"].includes(data.segment)) {
      const sel = supabaseAdmin
        .from("subscriptions")
        .select("user_id, product_id, status, current_period_end")
        .eq("environment", "live")
        .order("created_at", { ascending: false })
        .limit(5000);
      const { data: rows } = await sel;
      const latest = new Map<string, { product_id: string; status: string; current_period_end: string | null }>();
      for (const r of rows ?? []) {
        if (!latest.has(r.user_id as string)) latest.set(r.user_id as string, r as any);
      }
      const now = Date.now();
      for (const [uid, s] of latest) {
        const inPeriod = !s.current_period_end || new Date(s.current_period_end).getTime() > now;
        const isActive =
          (["active", "trialing", "past_due"].includes(s.status) && inPeriod) ||
          (s.status === "canceled" && inPeriod);
        if (data.segment === "pro" && isActive && s.product_id === "pro_plan") userIds.push(uid);
        else if (data.segment === "team" && isActive && s.product_id === "team_plan") userIds.push(uid);
        else if (data.segment === "trialing" && s.status === "trialing") userIds.push(uid);
        else if (data.segment === "past_due" && s.status === "past_due") userIds.push(uid);
        else if (data.segment === "canceled" && s.status === "canceled") userIds.push(uid);
      }
    } else if (data.segment === "trial_ending") {
      const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const { data: rows } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .eq("environment", "live")
        .eq("status", "trialing")
        .lte("current_period_end", soon);
      userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id as string)));
    } else if (data.segment === "inactive_14d") {
      const fromISO = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const [{ data: allP }, { data: recent }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id").limit(10000),
        supabaseAdmin.from("login_history").select("user_id").gte("occurred_at", fromISO),
      ]);
      const recentSet = new Set((recent ?? []).map((r) => r.user_id as string));
      userIds = (allP ?? [])
        .map((p) => p.id as string)
        .filter((id) => !recentSet.has(id));
    } else if (data.segment === "free") {
      const [{ data: all }, { data: subs }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id").limit(10000),
        supabaseAdmin
          .from("subscriptions")
          .select("user_id, status, current_period_end")
          .eq("environment", "live"),
      ]);
      const paidIds = new Set<string>();
      for (const s of subs ?? []) {
        const inPeriod = !s.current_period_end || new Date(s.current_period_end as string) > new Date();
        if (inPeriod && ["active", "trialing", "past_due"].includes(s.status as string)) {
          paidIds.add(s.user_id as string);
        }
      }
      userIds = (all ?? []).map((p) => p.id as string).filter((id) => !paidIds.has(id));
    }

    userIds = userIds.slice(0, limit);
    if (!userIds.length) return { users: [] };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, organisation, status, created_at")
      .in("id", userIds);

    return { users: profiles ?? [] };
  });

// On-demand rollup refresh (manual button in dashboard)
export const analyticsRefreshNow = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await Promise.all([
      supabaseAdmin.rpc("refresh_analytics_for_day", { p_day: today }),
      supabaseAdmin.rpc("refresh_analytics_for_day", { p_day: yest }),
      supabaseAdmin.rpc("refresh_subscription_snapshot_for_day", { p_day: today }),
      supabaseAdmin.rpc("refresh_subscription_snapshot_for_day", { p_day: yest }),
    ]);
    return { ok: true, at: new Date().toISOString() };
  });

export const PRICE_REFS = { PRICE_PRO_MONTH, PRICE_PRO_YEAR, PRICE_TEAM_MONTH, PRICE_TEAM_YEAR };
