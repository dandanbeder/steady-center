/**
 * Weekly review generator — pure server module.
 * Computes per-business + overall metrics for a 7-day window, asks Claude for
 * a JSON narrative, persists a weekly_reports row, and emails it via Resend.
 *
 * Server-only (uses service-role client + ANTHROPIC_API_KEY).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_URL = "https://connector-gateway.lovable.dev/resend/emails";
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
};

export type ReportNarrative = {
  headline: string;
  wins: string[];
  slipped: string[];
  at_risk: string[];
  suggestions: string[];
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

  const [
    { data: businesses },
    tasksRes,
    meetingsRes,
    actionsRes,
    notesRes,
    priorRes,
  ] = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name").eq("owner_id", userId),
    supabaseAdmin
      .from("tasks")
      .select(
        "id, title, status, priority, due_at, completed_at, created_at, business_id",
      )
      .eq("owner_id", userId),
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
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabaseAdmin
      .from("weekly_reports")
      .select("metrics, week_end")
      .eq("owner_id", userId)
      .lt("week_end", startIso)
      .order("week_end", { ascending: false })
      .limit(1),
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
  });
  const overall = blank(null);
  overall.business_name = "Overall";
  const buckets = new Map<string | null, PerBusinessMetrics>();
  for (const k of bucketKeys) buckets.set(k, blank(k));

  const inWeek = (iso: string | null) => !!iso && iso >= startIso && iso <= endIso;
  const isHi = (p: string) => p === "urgent" || p === "high";
  const now = weekEnd;
  const next7 = new Date(next7End);

  for (const t of tasks) {
    const b = buckets.get(t.business_id) ?? buckets.get(null)!;
    if (inWeek(t.created_at)) {
      b.tasks_created++;
      overall.tasks_created++;
    }
    if (t.status === "done" && inWeek(t.completed_at)) {
      b.tasks_completed++;
      overall.tasks_completed++;
      // on time = no due date OR completed_at <= due_at
      const onTime = !t.due_at || (!!t.completed_at && t.completed_at <= t.due_at);
      if (onTime) {
        b.completed_on_time++;
        overall.completed_on_time++;
      } else {
        b.completed_late++;
        overall.completed_late++;
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

  // Completion rate per bucket
  const rate = (b: PerBusinessMetrics) =>
    b.tasks_created === 0 ? 0 : b.tasks_completed / b.tasks_created;
  for (const b of buckets.values()) {
    b.completion_rate = rate(b);
    b.still_open_overdue.sort((x, y) => y.days_overdue - x.days_overdue);
    b.dropped_balls.sort((x, y) => y.days_overdue - x.days_overdue);
    b.still_open_overdue = b.still_open_overdue.slice(0, 25);
    b.dropped_balls = b.dropped_balls.slice(0, 25);
    b.at_risk = b.at_risk.slice(0, 25);
  }
  overall.completion_rate = rate(overall);
  overall.still_open_overdue.sort((x, y) => y.days_overdue - x.days_overdue);
  overall.dropped_balls.sort((x, y) => y.days_overdue - x.days_overdue);
  overall.still_open_overdue = dedupeById(overall.still_open_overdue).slice(0, 25);
  overall.dropped_balls = dedupeById(overall.dropped_balls).slice(0, 25);
  overall.at_risk = dedupeById(overall.at_risk).slice(0, 25);

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

  const metrics: ReportMetrics = { overall, per_business, vs_last_week };
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
  if (to) await sendReportEmail(to, weekStart, weekEnd, metrics, narrative);

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
      b.at_risk.length >
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

Rules:
- Be specific. When something slipped, name the actual overdue high-priority task by title and how many days late.
- Give genuine credit for real wins (numbers help). Don't manufacture wins.
- Never shame. Always pair criticism with a next action.
- End with 2-3 concrete suggestions, each starting with a verb.
- Keep it tight. If there's little data, say so honestly — don't pad.
- Return ONLY JSON, no prose around it, matching exactly:
{
  "headline": string,
  "wins": string[],
  "slipped": string[],
  "at_risk": string[],
  "suggestions": string[]
}`;

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
        max_tokens: 1200,
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
    return parseNarrative(text) ?? fallbackNarrative(metrics);
  } catch (e) {
    console.error("Anthropic call failed", e);
    return fallbackNarrative(metrics);
  }
}

function parseNarrative(text: string): ReportNarrative | null {
  if (!text) return null;
  // Tolerate ```json fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<ReportNarrative>;
    return {
      headline: String(obj.headline ?? ""),
      wins: Array.isArray(obj.wins) ? obj.wins.map(String) : [],
      slipped: Array.isArray(obj.slipped) ? obj.slipped.map(String) : [],
      at_risk: Array.isArray(obj.at_risk) ? obj.at_risk.map(String) : [],
      suggestions: Array.isArray(obj.suggestions)
        ? obj.suggestions.map(String)
        : [],
    };
  } catch {
    return null;
  }
}

function fallbackNarrative(m: ReportMetrics): ReportNarrative {
  const o = m.overall;
  return {
    headline:
      o.tasks_completed === 0 && o.tasks_created === 0
        ? "Quiet week — almost no activity logged."
        : `${o.tasks_completed} done, ${o.dropped_balls.length} dropped balls.`,
    wins:
      o.tasks_completed > 0
        ? [`Closed ${o.tasks_completed} tasks (${o.completed_on_time} on time).`]
        : [],
    slipped: o.dropped_balls
      .slice(0, 5)
      .map((t) => `${t.title} — ${t.days_overdue}d overdue`),
    at_risk: o.at_risk.slice(0, 5).map((t) => t.title),
    suggestions: [
      "Clear the top 3 overdue items first thing Monday.",
      "Block calendar time for at-risk high-priority work.",
      "Capture next actions for each open meeting decision.",
    ],
  };
}

async function sendReportEmail(
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
  const subject = `Weekly review: ${weekStart.toISOString().slice(0, 10)} → ${weekEnd
    .toISOString()
    .slice(0, 10)}`;
  const o = metrics.overall;
  const list = (arr: string[]) =>
    arr.length
      ? `<ul style="margin:8px 0 16px 18px;padding:0">${arr
          .map((x) => `<li style="margin:4px 0">${escapeHtml(x)}</li>`)
          .join("")}</ul>`
      : `<p style="color:#888;margin:8px 0 16px">—</p>`;
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
      <h2 style="margin:0 0 4px">${escapeHtml(narrative.headline || "Your weekly review")}</h2>
      <p style="color:#666;margin:0 0 20px">${weekStart.toDateString()} – ${weekEnd.toDateString()}</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        <tr>
          ${statCell("Done", o.tasks_completed)}
          ${statCell("Created", o.tasks_created)}
          ${statCell("On time", o.completed_on_time)}
          ${statCell("Late", o.completed_late)}
        </tr>
        <tr>
          ${statCell("Completion", Math.round(o.completion_rate * 100) + "%")}
          ${statCell("Meetings", o.meetings_count)}
          ${statCell("Notes", o.notes_added)}
          ${statCell("Dropped", o.dropped_balls.length)}
        </tr>
      </table>
      <h3 style="margin:0 0 4px">Wins</h3>${list(narrative.wins)}
      <h3 style="margin:0 0 4px">What slipped</h3>${list(narrative.slipped)}
      <h3 style="margin:0 0 4px">At risk</h3>${list(narrative.at_risk)}
      <h3 style="margin:0 0 4px">Suggestions</h3>${list(narrative.suggestions)}
    </div>`;
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: "Heartbeat <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, (await res.text()).slice(0, 300));
  }
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
