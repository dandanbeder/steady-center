import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function callClaude(opts: { system: string; user: string; maxTokens?: number }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI is not configured (missing key).");
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
    console.error("Anthropic error", res.status, t.slice(0, 400));
    throw new Error(`AI call failed (${res.status})`);
  }
  const j = (await res.json()) as AnthropicResponse;
  return {
    text: j.content?.find((c) => c.type === "text")?.text?.trim() ?? "",
    input_tokens: j.usage?.input_tokens ?? 0,
    output_tokens: j.usage?.output_tokens ?? 0,
  };
}

function parseJsonBlock<T>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) cleaned = m[0];
  }
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}

/**
 * Propose a small set of starter tasks/milestones for a brand-new Outcome.
 * Never persists — caller previews and confirms.
 */
export const suggestOutcomePlan = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        name: z.string().min(1).max(200),
        success_statement: z.string().max(2000).optional().nullable(),
        metric_name: z.string().max(120).optional().nullable(),
        metric_target: z.number().nullable().optional(),
        metric_unit: z.string().max(40).optional().nullable(),
        target_date: z.string().max(20).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    await assertAiBudget(context.userId);

    const today = new Date().toISOString().slice(0, 10);
    const sys = `You're a calm planning coach. Given an outcome (goal), propose a SMALL starter plan: the first sensible next steps that would move it forward. This is NOT an exhaustive project plan — just enough to unblock the user.

Return ONLY JSON:
{ "tasks": [{ "title": string, "priority": "urgent"|"high"|"normal"|"low", "days_offset": number | null }] }

Rules:
- 3 to 6 tasks max. Each is a single concrete action (verb-led), not a phase.
- Order them in the natural sequence they'd be done.
- priority: default "normal"; use "high" only for clear early-unblockers.
- days_offset: integer days from today (${today}) when this should be done by, or null if no obvious deadline. Stagger sensibly across the time available before the target date if one is given.
- Do not invent metrics or facts. Ground tasks in the outcome's success statement.`;

    const userMsg = [
      `Outcome: ${data.name}`,
      data.success_statement ? `What success looks like: ${data.success_statement}` : null,
      data.metric_name && data.metric_target != null
        ? `Target metric: ${data.metric_name} → ${data.metric_target}${data.metric_unit ? ` ${data.metric_unit}` : ""}`
        : null,
      data.target_date ? `Target date: ${data.target_date}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const { text, input_tokens, output_tokens } = await callClaude({
      system: sys,
      user: userMsg,
      maxTokens: 1000,
    });
    await recordAiUsage(context.userId, MODEL, input_tokens, output_tokens).catch(() => undefined);

    const parsed = parseJsonBlock<{
      tasks: Array<{
        title: string;
        priority: "urgent" | "high" | "normal" | "low";
        days_offset: number | null;
      }>;
    }>(text);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error("AI returned an unparseable response.");
    }
    const tasks = parsed.tasks.slice(0, 8).map((t) => ({
      title: String(t.title).slice(0, 200),
      priority: (["urgent", "high", "normal", "low"] as const).includes(t.priority)
        ? t.priority
        : ("normal" as const),
      days_offset:
        typeof t.days_offset === "number" && Number.isFinite(t.days_offset)
          ? Math.max(0, Math.round(t.days_offset))
          : null,
    }));
    return { tasks };
  });
