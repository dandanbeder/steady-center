import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

// ----------------------------------------------------------------------
// TEAM REPORT (Team plan). SHARED work only.
//
// Private-first contract:
//   - Tasks counted ONLY when business_id is a team account the caller is
//     an active member of AND the task has an assignee_id. Owner-only
//     unassigned tasks in a team account stay out — they're not "shared".
//   - Outcomes counted when business_id is a team account (team-scoped
//     by construction).
//   - Team commitments = weekly_goals tagged to a team account in period
//     (count only, never titles).
//   - Notes and Journal are NEVER read here.
//   - RLS scopes everything as the caller via context.supabase.
//
// Role gating:
//   - owner/admin: per-member + per-account breakdown.
//   - member/viewer/commenter: aggregate roll-up only — no per-member.
// ----------------------------------------------------------------------

type Role = "owner" | "admin" | "member" | "viewer" | "commenter";

type Counts = {
  total: number;
  todo: number;
  in_progress: number;
  review: number;
  done: number;
  overdue: number;
  completed_in_period: number;
};

export type TeamReportResult = {
  scope: {
    can_see_member_breakdown: boolean;
    period_start: string;
    period_end: string;
    granularity: "week" | "month";
    businesses: Array<{ id: string; name: string; color: string | null; role: Role | null }>;
    members: Array<{ user_id: string; full_name: string }>;
  };
  totals: {
    shared_tasks: number;
    completed_in_period: number;
    open: number;
    overdue: number;
    completion_rate: number;
    outcomes_active: number;
    outcomes_achieved_in_period: number;
    team_commitments: number;
    team_commitments_met: number;
  };
  by_status: { todo: number; in_progress: number; review: number; done: number; overdue: number };
  by_account: Array<{
    business_id: string;
    name: string;
    color: string | null;
    total: number;
    completed: number;
    open: number;
    overdue: number;
    completion_rate: number;
  }>;
  by_member: Array<{
    user_id: string;
    full_name: string;
    total: number;
    completed: number;
    in_progress: number;
    overdue: number;
    completion_rate: number;
  }>;
  by_outcome: Array<{
    id: string;
    name: string;
    business_id: string | null;
    status: string;
    target_date: string | null;
    total_tasks: number;
    completed_tasks: number;
    progress: number;
  }>;
  trend: Array<{ bucket_start: string; completed: number; created: number }>;
};

function newCounts(): Counts {
  return {
    total: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    overdue: 0,
    completed_in_period: 0,
  };
}

function startOfWeekUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday start
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function bucketKey(d: Date, granularity: "week" | "month"): string {
  const b = granularity === "week" ? startOfWeekUTC(d) : startOfMonthUTC(d);
  return b.toISOString().slice(0, 10);
}

function buildBuckets(start: Date, end: Date, granularity: "week" | "month"): string[] {
  const keys: string[] = [];
  let cur = granularity === "week" ? startOfWeekUTC(start) : startOfMonthUTC(start);
  const last = granularity === "week" ? startOfWeekUTC(end) : startOfMonthUTC(end);
  while (cur <= last) {
    keys.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur);
    if (granularity === "week") cur.setUTCDate(cur.getUTCDate() + 7);
    else cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return keys;
}

export const getTeamReport = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        businessId: z.string().uuid().nullable().optional(),
        periodStart: z.string(), // ISO date or datetime
        periodEnd: z.string(),
        granularity: z.enum(["week", "month"]).default("week"),
        status: z.enum(["todo", "in_progress", "review", "done", "overdue"]).nullable().optional(),
        outcomeId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TeamReportResult> => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "team_sharing");

    const periodStart = new Date(data.periodStart);
    const periodEnd = new Date(data.periodEnd);
    const granularity = data.granularity;

    // 1. Caller's team memberships (active). RLS already scopes this.
    const { data: myMems, error: e1 } = await supabase
      .from("memberships")
      .select("business_id, role")
      .eq("user_id", userId)
      .eq("status", "active");
    if (e1) throw e1;

    let myMemRows = (myMems ?? []) as Array<{ business_id: string; role: Role }>;
    if (data.businessId) myMemRows = myMemRows.filter((m) => m.business_id === data.businessId);
    const allBizIds = Array.from(new Set(myMemRows.map((m) => m.business_id)));

    // A "team" business has >=2 active members. Find those by counting.
    let teamBizIds: string[] = [];
    let bizRows: Array<{ id: string; name: string; color: string | null }> = [];
    if (allBizIds.length > 0) {
      const { data: counts, error: e2 } = await supabase
        .from("memberships")
        .select("business_id, user_id")
        .in("business_id", allBizIds)
        .eq("status", "active")
        .not("user_id", "is", null);
      if (e2) throw e2;
      const countMap = new Map<string, Set<string>>();
      for (const r of counts ?? []) {
        const set = countMap.get(r.business_id as string) ?? new Set<string>();
        set.add(r.user_id as string);
        countMap.set(r.business_id as string, set);
      }
      teamBizIds = allBizIds.filter((id) => (countMap.get(id)?.size ?? 0) >= 2);
      if (teamBizIds.length > 0) {
        const { data: bz } = await supabase
          .from("businesses")
          .select("id, name, color")
          .in("id", teamBizIds);
        bizRows = (bz ?? []) as typeof bizRows;
      }
    }

    const myRoleByBiz = new Map(myMemRows.map((m) => [m.business_id, m.role]));
    const canSeeMemberBreakdown = myMemRows.some(
      (m) => teamBizIds.includes(m.business_id) && (m.role === "owner" || m.role === "admin"),
    );

    const empty: TeamReportResult = {
      scope: {
        can_see_member_breakdown: canSeeMemberBreakdown,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        granularity,
        businesses: bizRows.map((b) => ({
          id: b.id,
          name: b.name,
          color: b.color,
          role: myRoleByBiz.get(b.id) ?? null,
        })),
        members: [],
      },
      totals: {
        shared_tasks: 0,
        completed_in_period: 0,
        open: 0,
        overdue: 0,
        completion_rate: 0,
        outcomes_active: 0,
        outcomes_achieved_in_period: 0,
        team_commitments: 0,
        team_commitments_met: 0,
      },
      by_status: { todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0 },
      by_account: [],
      by_member: [],
      by_outcome: [],
      trend: buildBuckets(periodStart, periodEnd, granularity).map((k) => ({
        bucket_start: k,
        completed: 0,
        created: 0,
      })),
    };

    if (teamBizIds.length === 0) return empty;

    // 2. Member roster of those team accounts (for member breakdown + names).
    const { data: mems2 } = await supabase
      .from("memberships")
      .select("business_id, user_id")
      .in("business_id", teamBizIds)
      .eq("status", "active")
      .not("user_id", "is", null);
    const memberUserIds = Array.from(
      new Set(((mems2 ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)),
    );
    let nameById: Record<string, string> = {};
    if (memberUserIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberUserIds);
      nameById = Object.fromEntries(
        (profs ?? []).map((p) => [
          p.id as string,
          (p.full_name as string) || "Teammate",
        ]),
      );
    }

    // 3. SHARED tasks: in team accounts, assigned, not deleted.
    let tasksQ = supabase
      .from("tasks")
      .select(
        "id, title, status, priority, due_at, business_id, assignee_id, outcome_id, completed_at, created_at, status_changed_at",
      )
      .is("deleted_at", null)
      .in("business_id", teamBizIds)
      .not("assignee_id", "is", null)
      // Period scope: include tasks created OR completed in period OR currently open.
      // We pull a wider set and filter in memory so per-bucket trend works.
      .or(
        `completed_at.gte.${periodStart.toISOString()},and(status.neq.done,deleted_at.is.null)`,
      );
    if (data.outcomeId) tasksQ = tasksQ.eq("outcome_id", data.outcomeId);
    if (data.status && data.status !== "overdue") tasksQ = tasksQ.eq("status", data.status);

    const { data: tasks, error: tErr } = await tasksQ;
    if (tErr) throw tErr;

    const now = Date.now();
    const totals = newCounts();
    const byStatus = { todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0 };
    const byBiz = new Map<string, Counts>();
    const byMember = new Map<string, Counts>();
    const byOutcomeTasks = new Map<string, { total: number; completed: number }>();
    const bucketKeys = buildBuckets(periodStart, periodEnd, granularity);
    const trendMap = new Map<string, { completed: number; created: number }>(
      bucketKeys.map((k) => [k, { completed: 0, created: 0 }]),
    );

    for (const t of tasks ?? []) {
      const status = (t.status as keyof typeof byStatus) ?? "todo";
      const completedAt = t.completed_at ? new Date(t.completed_at as string) : null;
      const createdAt = t.created_at ? new Date(t.created_at as string) : null;
      const inPeriodCompleted =
        !!completedAt && completedAt >= periodStart && completedAt <= periodEnd;
      const inPeriodCreated = !!createdAt && createdAt >= periodStart && createdAt <= periodEnd;
      const due = t.due_at ? new Date(t.due_at as string).getTime() : null;
      const isOverdue = !!due && due < now && status !== "done";

      // Status filter "overdue" handled here
      if (data.status === "overdue" && !isOverdue) continue;

      totals.total += 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (isOverdue) {
        totals.overdue += 1;
        byStatus.overdue += 1;
      }
      if (inPeriodCompleted) totals.completed_in_period += 1;

      const bizId = t.business_id as string;
      const memberId = t.assignee_id as string;
      const bizC = byBiz.get(bizId) ?? newCounts();
      bizC.total += 1;
      (bizC as Record<string, number>)[status] = ((bizC as Record<string, number>)[status] ?? 0) + 1;
      if (isOverdue) bizC.overdue += 1;
      if (inPeriodCompleted) bizC.completed_in_period += 1;
      byBiz.set(bizId, bizC);

      const memC = byMember.get(memberId) ?? newCounts();
      memC.total += 1;
      (memC as Record<string, number>)[status] = ((memC as Record<string, number>)[status] ?? 0) + 1;
      if (isOverdue) memC.overdue += 1;
      if (inPeriodCompleted) memC.completed_in_period += 1;
      byMember.set(memberId, memC);

      if (t.outcome_id) {
        const oid = t.outcome_id as string;
        const o = byOutcomeTasks.get(oid) ?? { total: 0, completed: 0 };
        o.total += 1;
        if (status === "done") o.completed += 1;
        byOutcomeTasks.set(oid, o);
      }

      if (inPeriodCompleted && completedAt) {
        const k = bucketKey(completedAt, granularity);
        const b = trendMap.get(k);
        if (b) b.completed += 1;
      }
      if (inPeriodCreated && createdAt) {
        const k = bucketKey(createdAt, granularity);
        const b = trendMap.get(k);
        if (b) b.created += 1;
      }
    }

    totals.completed_in_period = totals.completed_in_period;
    const openCount =
      (byStatus.todo ?? 0) + (byStatus.in_progress ?? 0) + (byStatus.review ?? 0);
    const completionRate =
      totals.total === 0 ? 0 : (byStatus.done ?? 0) / totals.total;

    // 4. Outcomes in team accounts (with optional filter).
    let outQ = supabase
      .from("outcomes")
      .select("id, name, status, business_id, target_date, updated_at, metric_current, metric_target")
      .in("business_id", teamBizIds);
    if (data.businessId) outQ = outQ.eq("business_id", data.businessId);
    if (data.outcomeId) outQ = outQ.eq("id", data.outcomeId);
    const { data: outcomes } = await outQ;
    const outcomesArr = (outcomes ?? []) as Array<{
      id: string;
      name: string;
      status: string;
      business_id: string | null;
      target_date: string | null;
      updated_at: string | null;
      metric_current: number | null;
      metric_target: number | null;
    }>;
    const outcomesActive = outcomesArr.filter(
      (o) => o.status !== "achieved" && o.status !== "dropped",
    ).length;
    const outcomesAchievedInPeriod = outcomesArr.filter(
      (o) =>
        o.status === "achieved" &&
        o.updated_at &&
        new Date(o.updated_at) >= periodStart &&
        new Date(o.updated_at) <= periodEnd,
    ).length;

    // 5. Team commitments (count only, no titles).
    const { data: goals } = await supabase
      .from("weekly_goals")
      .select("id, status, business_id, week_start")
      .in("business_id", teamBizIds)
      .gte("week_start", periodStart.toISOString().slice(0, 10))
      .lte("week_start", periodEnd.toISOString().slice(0, 10));
    const goalsArr = (goals ?? []) as Array<{ status: string | null }>;
    const teamCommitments = goalsArr.length;
    const teamCommitmentsMet = goalsArr.filter((g) => g.status === "met").length;

    return {
      scope: {
        can_see_member_breakdown: canSeeMemberBreakdown,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        granularity,
        businesses: bizRows.map((b) => ({
          id: b.id,
          name: b.name,
          color: b.color,
          role: myRoleByBiz.get(b.id) ?? null,
        })),
        members: canSeeMemberBreakdown
          ? memberUserIds.map((id) => ({ user_id: id, full_name: nameById[id] ?? "Teammate" }))
          : [],
      },
      totals: {
        shared_tasks: totals.total,
        completed_in_period: totals.completed_in_period,
        open: openCount,
        overdue: totals.overdue,
        completion_rate: completionRate,
        outcomes_active: outcomesActive,
        outcomes_achieved_in_period: outcomesAchievedInPeriod,
        team_commitments: teamCommitments,
        team_commitments_met: teamCommitmentsMet,
      },
      by_status: byStatus,
      by_account: bizRows.map((b) => {
        const c = byBiz.get(b.id) ?? newCounts();
        const open = (c.todo ?? 0) + (c.in_progress ?? 0) + (c.review ?? 0);
        return {
          business_id: b.id,
          name: b.name,
          color: b.color,
          total: c.total,
          completed: c.done,
          open,
          overdue: c.overdue,
          completion_rate: c.total === 0 ? 0 : c.done / c.total,
        };
      }),
      by_member: canSeeMemberBreakdown
        ? memberUserIds
            .map((uid) => {
              const c = byMember.get(uid) ?? newCounts();
              return {
                user_id: uid,
                full_name: nameById[uid] ?? "Teammate",
                total: c.total,
                completed: c.done,
                in_progress: c.in_progress,
                overdue: c.overdue,
                completion_rate: c.total === 0 ? 0 : c.done / c.total,
              };
            })
            .filter((m) => m.total > 0)
            .sort((a, b) => b.completed - a.completed)
        : [],
      by_outcome: outcomesArr
        .map((o) => {
          const c = byOutcomeTasks.get(o.id) ?? { total: 0, completed: 0 };
          const metricProgress =
            o.metric_target && o.metric_target > 0 && o.metric_current !== null
              ? Math.min(1, (o.metric_current ?? 0) / o.metric_target)
              : null;
          const taskProgress = c.total === 0 ? 0 : c.completed / c.total;
          return {
            id: o.id,
            name: o.name,
            business_id: o.business_id,
            status: o.status,
            target_date: o.target_date,
            total_tasks: c.total,
            completed_tasks: c.completed,
            progress: metricProgress ?? taskProgress,
          };
        })
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 20),
      trend: bucketKeys.map((k) => ({
        bucket_start: k,
        completed: trendMap.get(k)?.completed ?? 0,
        created: trendMap.get(k)?.created ?? 0,
      })),
    };
  });
