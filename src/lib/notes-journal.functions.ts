import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth])
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
// Ask my notes — keyword search + Claude summarisation over matches.
// Always returns the source notes so the user can verify.
// =============================================================
export const askNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        question: z.string().min(2).max(500),
        businessId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.question.trim();
    // Pull tokens (alpha, length >= 3) to seed an OR ilike search.
    const tokens = Array.from(
      new Set(
        q
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !STOP.has(w)),
      ),
    ).slice(0, 6);

    let query = supabase
      .from("notes")
      .select("id, title, body, business_id, updated_at, note_type")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data.businessId) query = query.eq("business_id", data.businessId);
    if (tokens.length) {
      // PostgREST .or() expects a comma-separated list of conditions.
      const filters = tokens
        .flatMap((t) => {
          const safe = t.replace(/[%,()]/g, "");
          return [`title.ilike.%${safe}%`, `body.ilike.%${safe}%`];
        })
        .join(",");
      query = query.or(filters);
    }
    const { data: notes = [], error } = await query;
    if (error) throw error;

    const matches = (notes as Array<{
      id: string;
      title: string;
      body: string;
      business_id: string | null;
      updated_at: string;
    }>).slice(0, data.limit ?? 8);

    if (matches.length === 0) {
      return { answer: "I couldn't find any notes that mention that.", matches: [] };
    }

    const corpus = matches
      .map((n, i) => `[${i + 1}] ${n.title || "Untitled"}\n${n.body.slice(0, 2000)}`)
      .join("\n\n---\n\n");

    const sys = `You answer questions strictly from the user's own notes.
- Cite sources with [n] inline matching the note numbers provided.
- If the notes don't answer the question, say so plainly and suggest what to capture.
- Be concise (under ~180 words). Use markdown.`;
    const user = `Question: ${q}\n\nNotes:\n${corpus}`;
    const answer = await callClaude({ system: sys, user, maxTokens: 800 });

    return {
      answer,
      matches: matches.map((n, i) => ({
        n: i + 1,
        id: n.id,
        title: n.title || "Untitled",
        snippet: n.body.slice(0, 220),
      })),
    };
  });

const STOP = new Set([
  "the","and","for","with","that","this","what","when","where","about","from","have","has","had",
  "did","does","you","your","mine","ours","their","they","them","into","over","under","there","here",
  "any","all","not","but","than","then","also","just","like","really","very","really","much","many",
  "decide","decided","decision","decisions",
]);
