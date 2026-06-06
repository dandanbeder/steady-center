/**
 * Weekly review generator — pure server module.
 * Computes per-business + overall metrics (tasks, hours, flow, goals) for a
 * 7-day window, asks Claude for a JSON narrative, persists a weekly_reports
 * row, and emails it via Resend.
 *
 * Server-only (uses service-role client + ANTHROPIC_API_KEY).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Resend is invoked via the shared email.server helper (sendMarketingEmail).
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

type Business = { id: string; name: string };

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  status_changed_at: string | null;
  business_id: string | null;
};

export type OverdueEntry = {
  id: string;
  title: string;
  priority: string;
  due_at: string | null;
  days_overdue: number;
};

export type AtRiskEntry = {
  id: string;
  title: string;
  priority: string;
  due_at: string | null;
};

export type OpenTaskAging = {
  id: string;
  title: string;
  business_name: string;
  priority: string;
  status: string;
  days_open: number;
  days_in_status: number;
};

export type TaskHours = {
  task_id: string;
  title: string;
  business_name: string;
  hours: number;
};

export type GoalProgress = {
  id: string;
  title: string;
  business_name: string;
  metric_type: "tasks_completed" | "hours" | "custom";
  target_value: number | null;
  current_value: number;
  status: "open" | "met" | "missed";
  progress_pct: number; // 0..100
};

export type OutcomeProgress = {
  id: string;
  name: string;
  business_name: string;
  status: "active" | "achieved" | "archived";
  target_date: string | null;
  days_remaining: number | null;
  total_tasks: number;
  done_tasks: number;
  progress_pct: number; // 0..100
};

export type FlowMetrics = {
  counts_by_status: Record<string, number>;
  stuck: OpenTaskAging[]; // open > 7 days
  oldest_open: OpenTaskAging[];
  avg_cycle_days: number | null; // for tasks completed this week
  throughput_this_week: number; // tasks completed this week
  throughput_last_week: number;
};

export type PerBusinessMetrics = {
  business_id: string | null;
  business_name: string;
  tasks_created: number;
  tasks_completed: number;
  completed_on_time: number;
  completed_late: number;
  due_this_week_total: number;
  due_this_week_done: number;
  completion_rate: number; // 0..1
  still_open_overdue: OverdueEntry[];
  high_priority_open: number;
  meetings_count: number;
  notes_added: number;
  action_items_created: number;
  action_items_closed: number;
  action_items_open: number;
  dropped_balls: OverdueEntry[];
  at_risk: AtRiskEntry[];
  tracked_hours?: number;
};

export type VsLastWeek = {
  tasks_completed: number;
  completion_rate: number;
  dropped_balls: number;
};

export type ReportMetrics = {
  overall: PerBusinessMetrics;
  per_business: PerBusinessMetrics[];
  vs_last_week: VsLastWeek | null;
  // New fields (optional for backward compat with older reports)
  tracked_hours_total?: number;
  top_tasks_hours?: TaskHours[];
  flow?: FlowMetrics;
  goals?: GoalProgress[];
  outcomes?: OutcomeProgress[];
};

export type Strength = { point: string; evidence: string };
export type GrowthArea = { point: string; why: string; suggestion: string };

export type ReportNarrative = {
  headline: string;
  // New shape
  strengths?: Strength[];
  growth_areas?: GrowthArea[];
  goal_review?: string;
  next_week?: string[];
  // Legacy fields kept for older reports + email fallback
  wins?: string[];
  slipped?: string[];
  at_risk?: string[];
  suggestions?: string[];
  legacy_text?: string;
};

export async function generateForUser(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<string> {
  const startIso = weekStart.toISOString();
  const endIso = weekEnd.toISOString();
  const lookbackStart = new Date(weekStart.getTime() - 7 * 86400_000).toISOString();
  const next7End = new Date(weekEnd.getTime() + 7 * 86400_000).toISOString();
  const prevWeekStartIso = new Date(weekStart.getTime() - 7 * 86400_000).toISOString();

  const [
    { data: businesses },
    tasksRes,
    meetingsRes,
    actionsRes,
    notesRes,
    priorRes,
    timeRes,
    goalsRes,
    prevTasksRes,
    outcomesRes,
  ] = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name").eq("owner_id", userId),
    supabaseAdmin
      .from("tasks")
      .select(
        "id, title, status, priority, due_at, completed_at, created_at, status_changed_at, business_id, outcome_id",
      )
      .eq("owner_id", userId)
      .is("deleted_at", null),
    supabaseAdmin
      .from("meetings")
      .select("id, business_id, created_at")
      .eq("owner_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabaseAdmin
      .from("action_items")
      .select("id, done, business_id, created_at")
      .eq("owner_id", userId)
      .gte("created_at", lookbackStart),
    supabaseAdmin
      .from("notes")
      .select("id, business_id, created_at")
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabaseAdmin
      .from("weekly_reports")
      .select("metrics, week_end")
      .eq("owner_id", userId)
      .lt("week_end", startIso)
      .order("week_end", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("time_entries")
      .select("task_id, business_id, minutes, started_at")
      .eq("user_id", userId)
      .gte("started_at", startIso)
      .lte("started_at", endIso),
    supabaseAdmin
      .from("weekly_goals")
      .select("*")
      .eq("user_id", userId)
      .lte("week_start", endIso)
      .gte("week_end", startIso),
    supabaseAdmin
      .from("tasks")
      .select("id, completed_at")
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .eq("status", "done")
      .gte("completed_at", prevWeekStartIso)
      .lt("completed_at", startIso),
    supabaseAdmin
      .from("outcomes")
      .select("id, name, business_id, target_date, status")
      .eq("owner_id", userId)
      .neq("status", "archived"),
  ]);

  const bizList: Business[] = (businesses ?? []) as Business[];
  const bizName = new Map<string | null, string>();
  bizName.set(null, "Unassigned");
  for (const b of bizList) bizName.set(b.id, b.name);

  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const meetings = (meetingsRes.data ?? []) as Array<{ business_id: string | null }>;
  const actions = (actionsRes.data ?? []) as Array<{
    done: boolean;
    business_id: string | null;
    created_at: string;
  }>;
  const notes = (notesRes.data ?? []) as Array<{ business_id: string | null }>;
  const timeEntries = (timeRes.data ?? []) as Array<{
    task_id: string;
    business_id: string | null;
    minutes: number;
  }>;
  const goalRows = (goalsRes.data ?? []) as Array<{
    id: string;
    business_id: string | null;
    title: string;
    metric_type: "tasks_completed" | "hours" | "custom";
    target_value: number | null;
    current_value: number;
    status: "open" | "met" | "missed";
  }>;
  const prevWeekCompleted = (prevTasksRes.data ?? []).length;

  const bucketKeys: Array<string | null> = [null, ...bizList.map((b) => b.id)];
  const blank = (id: string | null): PerBusinessMetrics => ({
    business_id: id,
    business_name: bizName.get(id) ?? "Unassigned",
    tasks_created: 0,
    tasks_completed: 0,
    completed_on_time: 0,
    completed_late: 0,
    due_this_week_total: 0,
    due_this_week_done: 0,
    completion_rate: 0,
    still_open_overdue: [],
    high_priority_open: 0,
    meetings_count: 0,
    notes_added: 0,
    action_items_created: 0,
    action_items_closed: 0,
    action_items_open: 0,
    dropped_balls: [],
    at_risk: [],
    tracked_hours: 0,
  });
  const overall = blank(null);
  overall.business_name = "Overall";
  const buckets = new Map<string | null, PerBusinessMetrics>();
  for (const k of bucketKeys) buckets.set(k, blank(k));

  const inWeek = (iso: string | null) => !!iso && iso >= startIso && iso <= endIso;
  const isHi = (p: string) => p === "urgent" || p === "high";
  const now = weekEnd;
  const next7 = new Date(next7End);

  // Flow trackers
  const counts_by_status: Record<string, number> = {};
  const openAging: OpenTaskAging[] = [];
  let cycleSumDays = 0;
  let cycleCount = 0;

  for (const t of tasks) {
    const b = buckets.get(t.business_id) ?? buckets.get(null)!;
    counts_by_status[t.status] = (counts_by_status[t.status] ?? 0) + 1;
    if (inWeek(t.created_at)) {
      b.tasks_created++;
      overall.tasks_created++;
    }
    if (t.status === "done" && inWeek(t.completed_at)) {
      b.tasks_completed++;
      overall.tasks_completed++;
      const onTime = !t.due_at || (!!t.completed_at && t.completed_at <= t.due_at);
      if (onTime) {
        b.completed_on_time++;
        overall.completed_on_time++;
      } else {
        b.completed_late++;
        overall.completed_late++;
      }
      if (t.completed_at) {
        const cycle =
          (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) /
          86400_000;
        if (cycle >= 0 && cycle < 365) {
          cycleSumDays += cycle;
          cycleCount++;
        }
      }
    }
    if (t.due_at && inWeek(t.due_at)) {
      b.due_this_week_total++;
      overall.due_this_week_total++;
      if (t.status === "done") {
        b.due_this_week_done++;
        overall.due_this_week_done++;
      }
    }
    if (t.status !== "done") {
      const daysOpen = Math.max(
        0,
        Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 86400_000),
      );
      const statusAnchor = t.status_changed_at ?? t.created_at;
      const daysInStatus = Math.max(
        0,
        Math.floor((now.getTime() - new Date(statusAnchor).getTime()) / 86400_000),
      );
      openAging.push({
        id: t.id,
        title: t.title,
        business_name: bizName.get(t.business_id) ?? "Unassigned",
        priority: t.priority,
        status: t.status,
        days_open: daysOpen,
        days_in_status: daysInStatus,
      });
      if (isHi(t.priority)) {
        b.high_priority_open++;
        overall.high_priority_open++;
      }
      if (t.due_at && t.due_at < endIso) {
        const days = Math.max(
          0,
          Math.floor((now.getTime() - new Date(t.due_at).getTime()) / 86400_000),
        );
        const entry: OverdueEntry = {
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_at: t.due_at,
          days_overdue: days,
        };
        b.still_open_overdue.push(entry);
        overall.still_open_overdue.push(entry);
        if (isHi(t.priority) || days > 3) {
          b.dropped_balls.push(entry);
          overall.dropped_balls.push(entry);
        }
      }
      if (
        isHi(t.priority) &&
        t.due_at &&
        t.due_at > endIso &&
        new Date(t.due_at) <= next7
      ) {
        const entry: AtRiskEntry = {
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_at: t.due_at,
        };
        b.at_risk.push(entry);
        overall.at_risk.push(entry);
      }
    }
  }
  for (const m of meetings) {
    (buckets.get(m.business_id) ?? buckets.get(null)!).meetings_count++;
    overall.meetings_count++;
  }
  for (const a of actions) {
    const b = buckets.get(a.business_id) ?? buckets.get(null)!;
    const createdInWeek = a.created_at >= startIso && a.created_at <= endIso;
    if (createdInWeek) {
      b.action_items_created++;
      overall.action_items_created++;
    }
    if (a.done) {
      b.action_items_closed++;
      overall.action_items_closed++;
    } else {
      b.action_items_open++;
      overall.action_items_open++;
    }
  }
  for (const n of notes) {
    (buckets.get(n.business_id) ?? buckets.get(null)!).notes_added++;
    overall.notes_added++;
  }

  // Hours
  const taskTitleById = new Map<string, { title: string; business_id: string | null }>();
  for (const t of tasks) taskTitleById.set(t.id, { title: t.title, business_id: t.business_id });
  const minutesPerTask = new Map<string, number>();
  let trackedMinutesTotal = 0;
  for (const e of timeEntries) {
    const m = e.minutes || 0;
    trackedMinutesTotal += m;
    minutesPerTask.set(e.task_id, (minutesPerTask.get(e.task_id) ?? 0) + m);
    const bizId = e.business_id ?? taskTitleById.get(e.task_id)?.business_id ?? null;
    const b = buckets.get(bizId) ?? buckets.get(null)!;
    b.tracked_hours = (b.tracked_hours ?? 0) + m / 60;
  }
  const top_tasks_hours: TaskHours[] = Array.from(minutesPerTask.entries())
    .map(([taskId, mins]) => {
      const info = taskTitleById.get(taskId);
      return {
        task_id: taskId,
        title: info?.title ?? "(deleted task)",
        business_name: bizName.get(info?.business_id ?? null) ?? "Unassigned",
        hours: Math.round((mins / 60) * 10) / 10,
      };
    })
    .filter((t) => t.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  // Completion rate per bucket + round hours
  const rate = (b: PerBusinessMetrics) =>
    b.tasks_created === 0 ? 0 : b.tasks_completed / b.tasks_created;
  for (const b of buckets.values()) {
    b.completion_rate = rate(b);
    b.tracked_hours = Math.round((b.tracked_hours ?? 0) * 10) / 10;
    b.still_open_overdue.sort((x, y) => y.days_overdue - x.days_overdue);
    b.dropped_balls.sort((x, y) => y.days_overdue - x.days_overdue);
    b.still_open_overdue = b.still_open_overdue.slice(0, 25);
    b.dropped_balls = b.dropped_balls.slice(0, 25);
    b.at_risk = b.at_risk.slice(0, 25);
  }
  overall.completion_rate = rate(overall);
  overall.tracked_hours = Math.round((trackedMinutesTotal / 60) * 10) / 10;
  overall.still_open_overdue.sort((x, y) => y.days_overdue - x.days_overdue);
  overall.dropped_balls.sort((x, y) => y.days_overdue - x.days_overdue);
  overall.still_open_overdue = dedupeById(overall.still_open_overdue).slice(0, 25);
  overall.dropped_balls = dedupeById(overall.dropped_balls).slice(0, 25);
  overall.at_risk = dedupeById(overall.at_risk).slice(0, 25);

  // Flow
  openAging.sort((a, b) => b.days_open - a.days_open);
  const flow: FlowMetrics = {
    counts_by_status,
    stuck: openAging.filter((t) => t.days_open > 7).slice(0, 20),
    oldest_open: openAging.slice(0, 15),
    avg_cycle_days: cycleCount > 0 ? Math.round((cycleSumDays / cycleCount) * 10) / 10 : null,
    throughput_this_week: overall.tasks_completed,
    throughput_last_week: prevWeekCompleted,
  };

  // Goals
  const goals: GoalProgress[] = goalRows.map((g) => {
    const pct =
      g.target_value && g.target_value > 0
        ? Math.min(100, Math.round((Number(g.current_value) / Number(g.target_value)) * 100))
        : g.status === "met"
          ? 100
          : 0;
    return {
      id: g.id,
      title: g.title,
      business_name: bizName.get(g.business_id) ?? "All Accounts",
      metric_type: g.metric_type,
      target_value: g.target_value !== null ? Number(g.target_value) : null,
      current_value: Number(g.current_value),
      status: g.status,
      progress_pct: pct,
    };
  });

  const per_business = bucketKeys.map((k) => buckets.get(k)!).filter(hasActivity);

  // vs last week
  let vs_last_week: VsLastWeek | null = null;
  const prior = (priorRes.data ?? [])[0]?.metrics as
    | { overall?: Partial<PerBusinessMetrics> }
    | undefined;
  if (prior?.overall) {
    vs_last_week = {
      tasks_completed:
        overall.tasks_completed - (prior.overall.tasks_completed ?? 0),
      completion_rate:
        overall.completion_rate - (prior.overall.completion_rate ?? 0),
      dropped_balls:
        overall.dropped_balls.length -
        ((prior.overall.dropped_balls as unknown[] | undefined)?.length ?? 0),
    };
  }

  const metrics: ReportMetrics = {
    overall,
    per_business,
    vs_last_week,
    tracked_hours_total: overall.tracked_hours,
    top_tasks_hours,
    flow,
    goals,
  };
  const narrative = await writeNarrative(metrics, weekStart, weekEnd);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("weekly_reports")
    .insert({
      owner_id: userId,
      business_id: null,
      week_start: startIso,
      week_end: endIso,
      metrics: JSON.parse(JSON.stringify(metrics)),
      narrative: JSON.parse(JSON.stringify(narrative)),
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  const to = user?.user?.email;
  if (to) await sendReportEmail(userId, to, weekStart, weekEnd, metrics, narrative);

  return (inserted as { id: string }).id;
}

function hasActivity(b: PerBusinessMetrics): boolean {
  return (
    b.tasks_created +
      b.tasks_completed +
      b.meetings_count +
      b.action_items_closed +
      b.action_items_open +
      b.notes_added +
      b.still_open_overdue.length +
      b.at_risk.length +
      (b.tracked_hours ?? 0) >
    0
  );
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

async function writeNarrative(
  metrics: ReportMetrics,
  weekStart: Date,
  weekEnd: Date,
): Promise<ReportNarrative> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackNarrative(metrics);

  const sys = `You write candid, constructive weekly reviews for a busy multi-business operator.

Tone:
- Direct, specific, never harsh. Give real credit for real wins. Reframe weaknesses as growth areas with a concrete next action.
- Cite evidence from the metrics (numbers, task titles, hours). Do not invent numbers.
- If the data is thin (few tasks, no hours, no goals), say so honestly. Don't pad.

Return ONLY JSON, no prose around it, matching exactly this shape:
{
  "headline": string,
  "strengths": [{"point": string, "evidence": string}],
  "growth_areas": [{"point": string, "why": string, "suggestion": string}],
  "goal_review": string,
  "next_week": [string, string, string]
}

- 2-4 strengths, each with evidence drawn from the metrics.
- 2-4 growth areas; "suggestion" must be a specific, actionable next step starting with a verb.
- "goal_review" is one short paragraph reviewing how the week's goals went (met / missed / partial). If there were no goals, say so.
- "next_week" is 2-3 focuses for the coming week, each starting with a verb.`;

  const user = `Week: ${weekStart.toISOString().slice(0, 10)} → ${weekEnd
    .toISOString()
    .slice(0, 10)}

Metrics JSON:
${JSON.stringify(metrics, null, 2)}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1600,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error", res.status, (await res.text()).slice(0, 400));
      return fallbackNarrative(metrics);
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    const parsed = parseNarrative(text);
    return parsed ? withLegacyFields(parsed, metrics) : fallbackNarrative(metrics);
  } catch (e) {
    console.error("Anthropic call failed", e);
    return fallbackNarrative(metrics);
  }
}

function parseNarrative(text: string): ReportNarrative | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<ReportNarrative>;
    const strengths: Strength[] = Array.isArray(obj.strengths)
      ? obj.strengths.map((s) => ({
          point: String((s as Strength)?.point ?? ""),
          evidence: String((s as Strength)?.evidence ?? ""),
        }))
      : [];
    const growth_areas: GrowthArea[] = Array.isArray(obj.growth_areas)
      ? obj.growth_areas.map((g) => ({
          point: String((g as GrowthArea)?.point ?? ""),
          why: String((g as GrowthArea)?.why ?? ""),
          suggestion: String((g as GrowthArea)?.suggestion ?? ""),
        }))
      : [];
    return {
      headline: String(obj.headline ?? ""),
      strengths,
      growth_areas,
      goal_review: String(obj.goal_review ?? ""),
      next_week: Array.isArray(obj.next_week) ? obj.next_week.map(String) : [],
    };
  } catch {
    return null;
  }
}

/** Mirror new narrative fields into legacy ones so the email + old UI still render. */
function withLegacyFields(n: ReportNarrative, _m: ReportMetrics): ReportNarrative {
  return {
    ...n,
    wins: (n.strengths ?? []).map((s) => s.point + (s.evidence ? ` — ${s.evidence}` : "")),
    slipped: (n.growth_areas ?? []).map((g) => `${g.point}${g.why ? ` (${g.why})` : ""}`),
    at_risk: [],
    suggestions: [
      ...(n.next_week ?? []),
      ...(n.growth_areas ?? []).map((g) => g.suggestion).filter(Boolean),
    ],
  };
}

function fallbackNarrative(m: ReportMetrics): ReportNarrative {
  const o = m.overall;
  const hours = o.tracked_hours ?? 0;
  const goals = m.goals ?? [];
  const goalReview =
    goals.length === 0
      ? "No weekly goals were set for this week."
      : `${goals.filter((g) => g.status === "met").length}/${goals.length} goals met.`;
  const strengths: Strength[] = [];
  if (o.tasks_completed > 0) {
    strengths.push({
      point: `Closed ${o.tasks_completed} tasks this week`,
      evidence: `${o.completed_on_time} on time, ${o.completed_late} late.`,
    });
  }
  if (hours > 0) {
    strengths.push({
      point: `Tracked ${hours}h of focused work`,
      evidence: `Across ${(m.top_tasks_hours ?? []).length} tasks.`,
    });
  }
  const growth: GrowthArea[] = [];
  if (o.dropped_balls.length > 0) {
    growth.push({
      point: `${o.dropped_balls.length} high-impact items overdue`,
      why: "These were past their due date with no movement.",
      suggestion: "Clear or reschedule the top 3 overdue items first thing Monday.",
    });
  }
  if ((m.flow?.stuck?.length ?? 0) > 0) {
    growth.push({
      point: `${m.flow!.stuck.length} tasks have been open more than a week`,
      why: "They're sitting without progress.",
      suggestion: "Pick one stuck task and either close it, delegate it, or break it down.",
    });
  }
  const n: ReportNarrative = {
    headline:
      o.tasks_completed === 0 && o.tasks_created === 0 && hours === 0
        ? "Quiet week — almost no activity logged."
        : `${o.tasks_completed} done · ${hours}h tracked · ${o.dropped_balls.length} overdue`,
    strengths,
    growth_areas: growth,
    goal_review: goalReview,
    next_week: [
      "Block calendar time for at-risk high-priority work.",
      "Review the oldest open tasks and decide: do, delegate, or drop.",
    ],
  };
  return withLegacyFields(n, m);
}

async function sendReportEmail(
  userId: string,
  to: string,
  weekStart: Date,
  weekEnd: Date,
  metrics: ReportMetrics,
  narrative: ReportNarrative,
) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey || !resendKey) {
    console.warn("Resend not configured — skipping email");
    return;
  }

  // Honour marketing opt-out: weekly review is a product-update email.
  const { canSendMarketing, sendMarketingEmail } = await import("./email.server");
  if (!(await canSendMarketing(userId))) {
    console.log("[weekly-report] user opted out of product updates, skipping email", userId);
    return;
  }

  const subject = `Your weekly review · ${weekStart.toISOString().slice(0, 10)} → ${weekEnd
    .toISOString()
    .slice(0, 10)}`;
  const o = metrics.overall;
  const strengths = narrative.strengths ?? [];
  const growth = narrative.growth_areas ?? [];
  const nextWeek = narrative.next_week ?? [];
  const strList = (items: Strength[]) =>
    items.length
      ? `<ul style="margin:8px 0 16px 18px;padding:0">${items
          .map(
            (s) =>
              `<li style="margin:6px 0"><strong>${escapeHtml(s.point)}</strong>${
                s.evidence ? ` — <span style="color:#555">${escapeHtml(s.evidence)}</span>` : ""
              }</li>`,
          )
          .join("")}</ul>`
      : `<p style="color:#888;margin:8px 0 16px">—</p>`;
  const growthList = (items: GrowthArea[]) =>
    items.length
      ? `<ul style="margin:8px 0 16px 18px;padding:0">${items
          .map(
            (g) =>
              `<li style="margin:8px 0"><strong>${escapeHtml(g.point)}</strong>${
                g.why ? ` — <span style="color:#555">${escapeHtml(g.why)}</span>` : ""
              }<br/><span style="color:#7A8471">→ ${escapeHtml(g.suggestion)}</span></li>`,
          )
          .join("")}</ul>`
      : `<p style="color:#888;margin:8px 0 16px">—</p>`;
  const plainList = (arr: string[]) =>
    arr.length
      ? `<ul style="margin:8px 0 16px 18px;padding:0">${arr
          .map((x) => `<li style="margin:4px 0">${escapeHtml(x)}</li>`)
          .join("")}</ul>`
      : `<p style="color:#888;margin:8px 0 16px">—</p>`;
  const bodyHtml = `
      <p style="color:#666;margin:0 0 20px">${weekStart.toDateString()} – ${weekEnd.toDateString()}</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        <tr>
          ${statCell("Hours", (o.tracked_hours ?? 0) + "h")}
          ${statCell("Done", o.tasks_completed)}
          ${statCell("On time %", Math.round(((o.completed_on_time / Math.max(1, o.tasks_completed)) * 100)) + "%")}
          ${statCell("Cycle", (metrics.flow?.avg_cycle_days ?? "—") + (metrics.flow?.avg_cycle_days != null ? "d" : ""))}
        </tr>
        <tr>
          ${statCell("Completion", Math.round(o.completion_rate * 100) + "%")}
          ${statCell("Meetings", o.meetings_count)}
          ${statCell("Notes", o.notes_added)}
          ${statCell("Overdue", o.dropped_balls.length)}
        </tr>
      </table>
      <h3 style="margin:0 0 4px">Strengths</h3>${strList(strengths)}
      <h3 style="margin:0 0 4px">Growth areas</h3>${growthList(growth)}
      <h3 style="margin:0 0 4px">Goal review</h3>
      <p style="margin:8px 0 16px">${escapeHtml(narrative.goal_review ?? "")}</p>
      <h3 style="margin:0 0 4px">Next week</h3>${plainList(nextWeek)}`;

  await sendMarketingEmail({
    userId,
    to,
    subject,
    heading: narrative.headline || "Your weekly review",
    intro: "A calm look back at the week — what moved, what stalled, what to pick up next.",
    bodyHtml,
  });
}

function statCell(label: string, n: number | string) {
  return `<td style="border:1px solid #eee;padding:12px;text-align:center">
    <div style="font-size:22px;font-weight:600">${n}</div>
    <div style="font-size:12px;color:#666">${label}</div>
  </td>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
