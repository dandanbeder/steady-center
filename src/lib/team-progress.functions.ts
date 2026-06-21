import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

// ----------------------------------------------------------------------
// Team progress, only ever shows work on shared accounts. Personal tasks,
// notes, and journal entries from a teammate are NEVER returned: we only
// query tasks whose business_id is an account both the caller and the
// teammate are active members of. RLS scopes everything as the caller.
// ----------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

type StatusCounts = {
  todo: number;
  in_progress: number;
  blocked: number;
  done: number;
  overdue: number;
  total: number;
};

export type TeamMemberProgress = {
  user_id: string;
  full_name: string;
  shared_business_ids: string[];
  counts: StatusCounts;
  in_progress: Array<{ id: string; title: string; due_at: string | null; business_id: string }>;
  overdue: Array<{ id: string; title: string; due_at: string | null; business_id: string }>;
  outcomes: Array<{
    id: string;
    name: string;
    status: string;
    business_id: string | null;
    task_count: number;
  }>;
};

export type TeamProgressResult = {
  shared_businesses: Array<{ id: string; name: string }>;
  members: TeamMemberProgress[];
};

async function loadSharedScope(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  filterBusinessId: string | null,
) {
  // Businesses where the caller is an active member (RLS already scopes this).
  const { data: myMems, error: e1 } = await supabase
    .from("memberships")
    .select("business_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (e1) throw e1;
  let bizIds = Array.from(
    new Set((myMems ?? []).map((m) => m.business_id).filter(Boolean) as string[]),
  );
  if (filterBusinessId) bizIds = bizIds.filter((id) => id === filterBusinessId);
  if (bizIds.length === 0) {
    return {
      bizIds: [] as string[],
      businesses: [] as Array<{ id: string; name: string }>,
      memberRows: [] as Array<{ business_id: string; user_id: string; full_name: string }>,
    };
  }

  const { data: bizRows } = await supabase
    .from("businesses")
    .select("id, name")
    .in("id", bizIds);
  const businesses = (bizRows ?? []) as Array<{ id: string; name: string }>;

  // All active members of those businesses (other than caller).
  const { data: mems, error: e2 } = await supabase
    .from("memberships")
    .select("business_id, user_id")
    .in("business_id", bizIds)
    .eq("status", "active")
    .not("user_id", "is", null);
  if (e2) throw e2;
  const others = (mems ?? []).filter((m) => m.user_id && m.user_id !== userId) as Array<{
    business_id: string;
    user_id: string;
  }>;
  const uniqueUserIds = Array.from(new Set(others.map((m) => m.user_id)));
  let profiles: Record<string, string> = {};
  if (uniqueUserIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uniqueUserIds);
    profiles = Object.fromEntries(
      (profs ?? []).map((p) => [p.id as string, (p.full_name as string) || "Teammate"]),
    );
  }
  const memberRows = others.map((m) => ({
    business_id: m.business_id,
    user_id: m.user_id,
    full_name: profiles[m.user_id] ?? "Teammate",
  }));
  return { bizIds, businesses, memberRows };
}

export const teamProgress = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({ businessId: z.string().uuid().nullable().optional() })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TeamProgressResult> => {
    const { supabase, userId } = context;
    const scope = await loadSharedScope(supabase, userId, data.businessId ?? null);
    if (scope.bizIds.length === 0 || scope.memberRows.length === 0) {
      return { shared_businesses: scope.businesses, members: [] };
    }

    // Pull tasks across shared accounts assigned to anyone on the team.
    // RLS confirms the caller can read them; the `business_id IN` filter
    // ensures we never see personal tasks (business_id NULL) of others.
    const assigneeIds = Array.from(new Set(scope.memberRows.map((m) => m.user_id)));
    const { data: tasks, error: tErr } = await supabase
      .from("tasks")
      .select("id, title, status, due_at, business_id, assignee_id, outcome_id")
      .is("deleted_at", null)
      .in("business_id", scope.bizIds)
      .in("assignee_id", assigneeIds);
    if (tErr) throw tErr;

    const outcomeIds = Array.from(
      new Set((tasks ?? []).map((t) => t.outcome_id).filter(Boolean) as string[]),
    );
    let outcomeById: Record<
      string,
      { id: string; name: string; status: string; business_id: string | null }
    > = {};
    if (outcomeIds.length) {
      const { data: outs } = await supabase
        .from("outcomes")
        .select("id, name, status, business_id")
        .in("id", outcomeIds);
      outcomeById = Object.fromEntries(
        (outs ?? []).map((o) => [
          o.id as string,
          {
            id: o.id as string,
            name: (o.name as string) || "Outcome",
            status: (o.status as string) || "in_progress",
            business_id: (o.business_id as string | null) ?? null,
          },
        ]),
      );
    }

    const now = Date.now();
    // Aggregate per member (dedupe shared businesses).
    const memberMap = new Map<string, TeamMemberProgress>();
    for (const m of scope.memberRows) {
      const existing = memberMap.get(m.user_id);
      if (existing) {
        if (!existing.shared_business_ids.includes(m.business_id)) {
          existing.shared_business_ids.push(m.business_id);
        }
        continue;
      }
      memberMap.set(m.user_id, {
        user_id: m.user_id,
        full_name: m.full_name,
        shared_business_ids: [m.business_id],
        counts: { todo: 0, in_progress: 0, blocked: 0, done: 0, overdue: 0, total: 0 },
        in_progress: [],
        overdue: [],
        outcomes: [],
      });
    }

    const outcomeTally = new Map<string, Map<string, number>>(); // user -> outcome -> count

    for (const t of tasks ?? []) {
      const mp = memberMap.get(t.assignee_id as string);
      if (!mp) continue;
      const status = t.status as keyof StatusCounts;
      mp.counts.total += 1;
      if (status in mp.counts) (mp.counts[status] as number) += 1;
      const due = t.due_at ? new Date(t.due_at as string).getTime() : null;
      const isOverdue = !!due && due < now && status !== "done";
      if (isOverdue) {
        mp.counts.overdue += 1;
        if (mp.overdue.length < 5) {
          mp.overdue.push({
            id: t.id as string,
            title: (t.title as string) || "Untitled",
            due_at: (t.due_at as string | null) ?? null,
            business_id: t.business_id as string,
          });
        }
      }
      if (status === "in_progress" && mp.in_progress.length < 5) {
        mp.in_progress.push({
          id: t.id as string,
          title: (t.title as string) || "Untitled",
          due_at: (t.due_at as string | null) ?? null,
          business_id: t.business_id as string,
        });
      }
      if (t.outcome_id) {
        let m1 = outcomeTally.get(mp.user_id);
        if (!m1) {
          m1 = new Map();
          outcomeTally.set(mp.user_id, m1);
        }
        m1.set(t.outcome_id as string, (m1.get(t.outcome_id as string) ?? 0) + 1);
      }
    }

    for (const [uid, m] of outcomeTally) {
      const mp = memberMap.get(uid);
      if (!mp) continue;
      mp.outcomes = Array.from(m.entries())
        .map(([oid, count]) => {
          const o = outcomeById[oid];
          if (!o) return null;
          return { ...o, task_count: count };
        })
        .filter(Boolean)
        .sort(
          (a, b) =>
            (b as { task_count: number }).task_count -
            (a as { task_count: number }).task_count,
        )
        .slice(0, 5) as TeamMemberProgress["outcomes"];
    }

    return {
      shared_businesses: scope.businesses,
      members: Array.from(memberMap.values()).sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      ),
    };
  });

// ----------------------------------------------------------------------
// Natural-language Q&A grounded in the same shared scope.
// ----------------------------------------------------------------------
type Source = {
  n: number;
  type: "task" | "outcome";
  id: string;
  title: string;
  snippet: string;
  link: string;
};

export const askTeam = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        question: z.string().min(2).max(500),
        businessId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "ai_assistant");
    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    const { assertAiCredits } = await import("./credits.server");
    await assertAiBudget(userId);
    await assertAiCredits(userId, 1);

    const scope = await loadSharedScope(supabase, userId, data.businessId ?? null);
    if (scope.bizIds.length === 0 || scope.memberRows.length === 0) {
      return {
        answer:
          "You don't have any shared accounts with teammates yet, so there's no team activity to look at.",
        matches: [] as Source[],
      };
    }

    const q = data.question.trim();
    const assigneeIds = Array.from(new Set(scope.memberRows.map((m) => m.user_id)));
    const tokens = Array.from(
      new Set(
        q
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3),
      ),
    ).slice(0, 6);

    let tasksQ = supabase
      .from("tasks")
      .select("id, title, description, status, due_at, business_id, assignee_id, outcome_id, status_changed_at")
      .is("deleted_at", null)
      .in("business_id", scope.bizIds)
      .in("assignee_id", assigneeIds)
      .order("status_changed_at", { ascending: false })
      .limit(40);
    if (tokens.length) {
      const safe = tokens.map((t) => t.replace(/[%,()]/g, ""));
      tasksQ = tasksQ.or(
        safe.flatMap((t) => [`title.ilike.%${t}%`, `description.ilike.%${t}%`]).join(","),
      );
    }

    let outcomesQ = supabase
      .from("outcomes")
      .select("id, name, description, success_statement, status, target_date, business_id")
      .in("business_id", scope.bizIds)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (tokens.length) {
      const safe = tokens.map((t) => t.replace(/[%,()]/g, ""));
      outcomesQ = outcomesQ.or(
        safe
          .flatMap((t) => [
            `name.ilike.%${t}%`,
            `description.ilike.%${t}%`,
            `success_statement.ilike.%${t}%`,
          ])
          .join(","),
      );
    }

    const [tRes, oRes] = await Promise.all([tasksQ, outcomesQ]);
    if (tRes.error) throw tRes.error;
    if (oRes.error) throw oRes.error;

    const nameById = Object.fromEntries(scope.memberRows.map((m) => [m.user_id, m.full_name]));
    const sources: Source[] = [];
    const corpusItems: string[] = [];
    let n = 0;

    for (const t of (tRes.data ?? []).slice(0, 10)) {
      n += 1;
      const who = nameById[t.assignee_id as string] ?? "Teammate";
      const due = t.due_at ? new Date(t.due_at as string).toISOString().slice(0, 10) : "";
      const snippet = `${who} · ${t.status}${due ? ` · due ${due}` : ""}`;
      sources.push({
        n,
        type: "task",
        id: t.id as string,
        title: (t.title as string) || "Untitled task",
        snippet,
        link: `/tasks?focus=${t.id}`,
      });
      corpusItems.push(
        `[${n}] (task) ${t.title}\nAssignee: ${who}\nStatus: ${t.status}${due ? `, due ${due}` : ""}\n${(t.description as string | null) ?? ""}`,
      );
    }
    for (const o of (oRes.data ?? []).slice(0, 6)) {
      n += 1;
      sources.push({
        n,
        type: "outcome",
        id: o.id as string,
        title: (o.name as string) || "Outcome",
        snippet: `${o.status}${o.target_date ? ` · target ${String(o.target_date).slice(0, 10)}` : ""}`,
        link: `/outcomes?focus=${o.id}`,
      });
      corpusItems.push(
        `[${n}] (outcome) ${o.name}\nStatus: ${o.status}${o.target_date ? `, target ${String(o.target_date).slice(0, 10)}` : ""}\nSuccess: ${o.success_statement ?? ""}\n${o.description ?? ""}`,
      );
    }

    if (sources.length === 0) {
      return {
        answer: "I couldn't find anything in your shared team work that mentions that.",
        matches: [] as Source[],
      };
    }

    const sys = `You answer questions about a team's SHARED work only.
- Use ONLY the items below. Cite every claim with [n].
- Frame answers as supportive coaching, progress, blockers, where to help, not surveillance.
- If the items don't answer the question, say so plainly.
- Be concise (under 180 words), markdown.`;
    const corpus = corpusItems.join("\n\n---\n\n");
    const user = `Question: ${q}\n\nItems:\n${corpus}`;

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI is not configured.");
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`AI call failed (${res.status})`);
    const j = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const answer = j.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    await recordAiUsage(
      userId,
      MODEL,
      j.usage?.input_tokens ?? 0,
      j.usage?.output_tokens ?? 0,
      { actionType: "team_progress" },
    ).catch(() => undefined);

    return { answer, matches: sources };
  });
