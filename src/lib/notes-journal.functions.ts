import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

async function callClaude(opts: { system: string; user: string; maxTokens?: number }) {
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
      max_tokens: opts.maxTokens ?? 1400,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Anthropic", res.status, t.slice(0, 300));
    throw new Error(`AI call failed (${res.status})`);
  }
  const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return j.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}

// =============================================================
// Today's journal pre-fill — summarises tasks completed, meetings
// attended, and notes made today. Returns markdown; user accepts/edits.
// =============================================================
export const journalPrefillToday = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        businessId: z.string().uuid().nullable().optional(),
        dateISO: z.string().optional(), // YYYY-MM-DD, defaults today
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const day = data.dateISO ? new Date(data.dateISO) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const tasksQ = supabase
      .from("tasks")
      .select("title, completed_at, business_id")
      .is("deleted_at", null)
      .gte("completed_at", start.toISOString())
      .lt("completed_at", end.toISOString());
    const meetingsQ = supabase
      .from("meetings")
      .select("title, summary, created_at, business_id")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
    const notesQ = supabase
      .from("notes")
      .select("title, body, note_type, created_at, business_id")
      .is("deleted_at", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    const [{ data: tasks = [] }, { data: meetings = [] }, { data: notes = [] }] = await Promise.all([
      tasksQ,
      meetingsQ,
      notesQ,
    ]);

    const biz = data.businessId ?? null;
    const filt = <T extends { business_id: string | null }>(rows: T[]) =>
      biz ? rows.filter((r) => r.business_id === biz) : rows;

    const t = filt(tasks as Array<{ business_id: string | null; title: string }>);
    const m = filt(
      meetings as Array<{ business_id: string | null; title: string; summary: string }>,
    );
    const n = filt(
      notes as Array<{
        business_id: string | null;
        title: string;
        body: string;
        note_type: string;
      }>,
    ).filter((x) => x.note_type !== "journal");

    const heading = `# ${start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })}`;

    // Always render a calm template, even if there's nothing.
    if (t.length === 0 && m.length === 0 && n.length === 0) {
      return {
        markdown: `${heading}\n\n## What happened today\n- \n\n## What I'm noticing\n- \n\n## What I want tomorrow\n- \n`,
      };
    }

    // Lightweight AI cleanup to weave it into a draft entry the user can edit.
    const facts = [
      t.length
        ? `Tasks completed:\n${t.map((x) => `- ${x.title}`).join("\n")}`
        : "",
      m.length
        ? `Meetings:\n${m
            .map((x) => `- ${x.title}${x.summary ? ` — ${x.summary.slice(0, 200)}` : ""}`)
            .join("\n")}`
        : "",
      n.length
        ? `Notes made:\n${n.map((x) => `- ${x.title || "(untitled)"}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const sys = `You draft a calm, first-person daily journal entry from a list of the day's activity.
Return MARKDOWN only. Use the headings:
## What happened today
## What I'm noticing
## What I want tomorrow
Keep it short, warm, and factual. Use the activity to populate "What happened today" as a bullet list. Leave the other sections with 1-2 gentle prompts in bullets the author can replace. Never invent activity that isn't listed.`;
    const user = `Today's activity:\n${facts}`;
    let body = "";
    try {
      body = await callClaude({ system: sys, user, maxTokens: 900 });
    } catch {
      // graceful fallback: render facts directly
      body = `## What happened today\n${[
        ...t.map((x) => `- Completed: ${x.title}`),
        ...m.map((x) => `- Meeting: ${x.title}`),
        ...n.map((x) => `- Note: ${x.title || "(untitled)"}`),
      ].join("\n")}\n\n## What I'm noticing\n- \n\n## What I want tomorrow\n- \n`;
    }
    return { markdown: `${heading}\n\n${body}` };
  });

// =============================================================
// Ask Heartbeat — cross-content assistant over notes, meetings,
// tasks, and outcomes. RLS scopes results to what the user can
// access; the active account filter narrows further.
// =============================================================
type SourceType = "note" | "meeting" | "task" | "outcome";
type SourceMatch = {
  n: number;
  type: SourceType;
  id: string;
  title: string;
  snippet: string;
  link: string;
};

function linkFor(type: SourceType, id: string): string {
  switch (type) {
    case "note":
      return `/notes?focus=${id}`;
    case "meeting":
      return `/meetings/${id}`;
    case "task":
      return `/tasks?focus=${id}`;
    case "outcome":
      return `/outcomes?focus=${id}`;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export const askNotes = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        question: z.string().min(2).max(500),
        businessId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(24).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, context.userId, "ai_assistant");
    // Server-side cap: counts against the AI allowance and $ budget.
    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    await assertAiBudget(context.userId);

    const q = data.question.trim();
    const biz = data.businessId ?? null;

    const tokens = Array.from(
      new Set(
        q
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !STOP.has(w)),
      ),
    ).slice(0, 6);

    const orFor = (fields: string[]) =>
      tokens.length
        ? tokens
            .flatMap((t) => {
              const safe = t.replace(/[%,()]/g, "");
              return fields.map((f) => `${f}.ilike.%${safe}%`);
            })
            .join(",")
        : null;

    // Build queries. RLS scopes to what the caller can access.
    let notesQ = supabase
      .from("notes")
      .select("id, title, body, business_id, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (biz) notesQ = notesQ.eq("business_id", biz);
    const notesOr = orFor(["title", "body"]);
    if (notesOr) notesQ = notesQ.or(notesOr);

    let meetingsQ = supabase
      .from("meetings")
      .select("id, title, summary, decisions, transcript, business_id, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (biz) meetingsQ = meetingsQ.eq("business_id", biz);
    const meetingsOr = orFor(["title", "summary", "decisions", "transcript"]);
    if (meetingsOr) meetingsQ = meetingsQ.or(meetingsOr);

    let tasksQ = supabase
      .from("tasks")
      .select(
        "id, title, description, status, due_at, business_id, completed_at, updated_at:status_changed_at",
      )
      .is("deleted_at", null)
      .order("status_changed_at", { ascending: false, nullsFirst: false })
      .limit(40);
    if (biz) tasksQ = tasksQ.eq("business_id", biz);
    const tasksOr = orFor(["title", "description"]);
    if (tasksOr) tasksQ = tasksQ.or(tasksOr);

    let outcomesQ = supabase
      .from("outcomes")
      .select(
        "id, name, description, success_statement, status, target_date, metric_name, metric_target, metric_current, metric_unit, business_id, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(20);
    if (biz) outcomesQ = outcomesQ.eq("business_id", biz);
    const outcomesOr = orFor(["name", "description", "success_statement", "metric_name"]);
    if (outcomesOr) outcomesQ = outcomesQ.or(outcomesOr);

    const [notesRes, meetingsRes, tasksRes, outcomesRes] = await Promise.all([
      notesQ,
      meetingsQ,
      tasksQ,
      outcomesQ,
    ]);
    if (notesRes.error) throw notesRes.error;
    if (meetingsRes.error) throw meetingsRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (outcomesRes.error) throw outcomesRes.error;

    const cap = data.limit ?? 12;
    const perType = Math.max(3, Math.ceil(cap / 2));

    type Built = {
      type: SourceType;
      id: string;
      title: string;
      body: string;
      snippet: string;
    };
    const built: Built[] = [];

    for (const n of (notesRes.data ?? []).slice(0, perType)) {
      built.push({
        type: "note",
        id: n.id,
        title: n.title || "Untitled note",
        body: `Note: ${n.title || "Untitled"}\n${(n.body ?? "").slice(0, 1600)}`,
        snippet: clip(n.body, 220),
      });
    }
    for (const m of (meetingsRes.data ?? []).slice(0, perType)) {
      const parts = [
        m.summary ? `Summary: ${m.summary}` : "",
        m.decisions ? `Decisions: ${m.decisions}` : "",
        m.transcript ? `Transcript: ${(m.transcript as string).slice(0, 1500)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      built.push({
        type: "meeting",
        id: m.id,
        title: `${m.title || "Meeting"} (${fmtDate(m.created_at)})`,
        body: `Meeting: ${m.title || "Untitled"} on ${fmtDate(m.created_at)}\n${parts}`,
        snippet: clip(m.summary || (m.decisions ? String(m.decisions) : "") || (m.transcript as string | null), 220),
      });
    }
    for (const t of (tasksRes.data ?? []).slice(0, perType)) {
      const meta = [
        `status: ${t.status}`,
        t.due_at ? `due: ${fmtDate(t.due_at)}` : "",
        t.completed_at ? `completed: ${fmtDate(t.completed_at)}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      built.push({
        type: "task",
        id: t.id,
        title: t.title || "Untitled task",
        body: `Task: ${t.title}\n(${meta})\n${(t.description ?? "").slice(0, 800)}`,
        snippet: clip(`${meta}${t.description ? ` — ${t.description}` : ""}`, 220),
      });
    }
    for (const o of (outcomesRes.data ?? []).slice(0, perType)) {
      const metric =
        o.metric_name && o.metric_target != null
          ? `${o.metric_current ?? 0}/${o.metric_target}${o.metric_unit ? ` ${o.metric_unit}` : ""} ${o.metric_name}`
          : "";
      built.push({
        type: "outcome",
        id: o.id,
        title: o.name || "Outcome",
        body: `Outcome: ${o.name}\nStatus: ${o.status}${o.target_date ? `, target ${fmtDate(o.target_date)}` : ""}${metric ? `\nProgress: ${metric}` : ""}\nSuccess looks like: ${o.success_statement ?? ""}\n${o.description ?? ""}`,
        snippet: clip(
          `${o.status}${metric ? ` · ${metric}` : ""} — ${o.success_statement ?? o.description ?? ""}`,
          220,
        ),
      });
    }

    const matches = built.slice(0, cap);

    if (matches.length === 0) {
      return {
        answer:
          "I couldn't find anything in your notes, meetings, tasks, or outcomes that mentions that.",
        matches: [] as SourceMatch[],
      };
    }

    const corpus = matches
      .map((m, i) => `[${i + 1}] (${m.type}) ${m.title}\n${m.body}`)
      .join("\n\n---\n\n");

    const sys = `You are Heartbeat's assistant. Answer the user's question STRICTLY from the provided items (notes, meetings, tasks, outcomes).
- Cite every claim with [n] matching the item numbers.
- If the items don't answer the question, say so plainly — never guess or fill in from general knowledge.
- Be concise (under ~200 words). Use markdown. Prefer specific names, dates, and statuses from the items.`;
    const user = `Question: ${q}\n\nItems:\n${corpus}`;
    const { text: answer, input_tokens, output_tokens } = await callClaudeFullLocal({
      system: sys,
      user,
      maxTokens: 900,
    });
    await recordAiUsage(context.userId, MODEL, input_tokens, output_tokens).catch(
      () => undefined,
    );

    return {
      answer,
      matches: matches.map<SourceMatch>((m, i) => ({
        n: i + 1,
        type: m.type,
        id: m.id,
        title: m.title,
        snippet: m.snippet,
        link: linkFor(m.type, m.id),
      })),
    };
  });

// Local variant of callClaude that also returns token usage for budgeting.
async function callClaudeFullLocal(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ text: string; input_tokens: number; output_tokens: number }> {
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
      max_tokens: opts.maxTokens ?? 1200,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Anthropic", res.status, t.slice(0, 300));
    throw new Error(`AI call failed (${res.status})`);
  }
  const j = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: j.content?.find((c) => c.type === "text")?.text?.trim() ?? "",
    input_tokens: j.usage?.input_tokens ?? 0,
    output_tokens: j.usage?.output_tokens ?? 0,
  };
}

const STOP = new Set([
  "the","and","for","with","that","this","what","when","where","about","from","have","has","had",
  "did","does","you","your","mine","ours","their","they","them","into","over","under","there","here",
  "any","all","not","but","than","then","also","just","like","really","very","really","much","many",
  "decide","decided","decision","decisions",
]);
