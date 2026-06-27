/**
 * AI suggestions for the user's weekly goals on the My Week page.
 *
 * - Invoked (never automatic).
 * - Reads ONLY the signed-in user's data via the RLS-scoped Supabase client:
 *   previous week's goals (to carry forward unfinished/recurring) and this
 *   week's existing goals (to avoid duplicates). The Journal is never read.
 * - Metered + logged via the shared credits/budget path. Throws on hard-stop.
 * - Returns an editable preview, NOTHING is created here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { routeModel } from "./ai-routing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ROUTE = routeModel("weekly_plan");
const MODEL = ROUTE.model;

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const METRICS = ["custom", "tasks_completed", "hours"] as const;
type Metric = (typeof METRICS)[number];

export type SuggestedGoal = {
  title: string;
  description: string | null;
  metric_type: Metric;
  target_value: number | null;
  business_id: string | null;
  carry_from_id: string | null;
};

function parseJsonBlock<T>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) cleaned = m[0];
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

const Input = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const suggestWeeklyGoals = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<{ suggestions: SuggestedGoal[] }> => {
    const { supabase, userId } = context;

    // Compute prev week range from the supplied week_start (UTC-anchored, matches client).
    const thisStart = new Date(`${data.week_start}T00:00:00.000Z`);
    const prevStart = new Date(thisStart);
    prevStart.setUTCDate(prevStart.getUTCDate() - 7);

    // Read user-scoped goals only. RLS limits to this user; no journal anywhere.
    const [prevRes, thisRes, bizRes] = await Promise.all([
      supabase
        .from("weekly_goals")
        .select("id, title, description, metric_type, target_value, current_value, status, business_id")
        .gte("week_start", prevStart.toISOString())
        .lt("week_start", thisStart.toISOString()),
      supabase
        .from("weekly_goals")
        .select("id, title")
        .gte("week_start", thisStart.toISOString())
        .lt("week_start", new Date(thisStart.getTime() + 7 * 86_400_000).toISOString()),
      supabase.from("businesses").select("id, name"),
    ]);

    const prev = prevRes.data ?? [];
    const existing = thisRes.data ?? [];
    const businesses = bizRes.data ?? [];
    const bizById = new Map(businesses.map((b) => [b.id as string, b.name as string]));
    const validBizIds = new Set(businesses.map((b) => b.id as string));

    // Credit + budget gates (will throw a clean CREDITS_EXHAUSTED if dry).
    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    const { assertAiCredits } = await import("./credits.server");
    await assertAiBudget(userId);
    await assertAiCredits(userId, 1);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI is not configured.");

    const sys = `You are a calm planning coach helping a busy operator shape ONE week.
Return ONLY JSON:
{ "suggestions": [{ "title": string, "description": string|null, "metric_type": "custom"|"tasks_completed"|"hours", "target_value": number|null, "business_id": string|null, "carry_from_id": string|null }] }

Rules:
- Propose 3 to 5 goals total.
- CARRY FORWARD goals from last week that were 'open' or 'missed' and still matter, set carry_from_id to that goal's id, keep its business_id when present, and you may refine the title or target.
- Suggest FRESH goals where helpful, but keep total ≤ 5 and avoid duplicating an existing goal already set for this week.
- Each goal: short imperative title (≤ 80 chars), optional one-sentence description.
- metric_type:
    * "tasks_completed" + integer target when the goal is naturally counted in tasks
    * "hours" + numeric target when it's a time commitment
    * "custom" + null target when it's a qualitative outcome
- business_id MUST be one of the provided business ids, or null for personal.
- No guilt or hustle framing. Calm, supportive, realistic for one week.`;

    const userMsg = [
      `Week starting: ${data.week_start}`,
      `Available accounts (business_id → name):`,
      businesses.length > 0
        ? businesses.map((b) => `  ${b.id} → ${b.name}`).join("\n")
        : "  (none, personal only)",
      ``,
      `Last week's goals:`,
      prev.length > 0
        ? JSON.stringify(prev, null, 2)
        : "  (none)",
      ``,
      `Goals ALREADY set for this week (do not duplicate):`,
      existing.length > 0
        ? JSON.stringify(existing, null, 2)
        : "  (none)",
    ].join("\n");

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: ROUTE.maxOutputTokens,
        system: sys,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("Anthropic error", res.status, t.slice(0, 400));
      throw new Error(`AI call failed (${res.status})`);
    }
    const j = (await res.json()) as AnthropicResponse;
    const text = j.content?.find((c) => c.type === "text")?.text?.trim() ?? "";

    await recordAiUsage(
      userId,
      MODEL,
      j.usage?.input_tokens ?? 0,
      j.usage?.output_tokens ?? 0,
      { actionType: "weekly_plan" },
    ).catch(() => undefined);

    const parsed = parseJsonBlock<{ suggestions: SuggestedGoal[] }>(text);
    if (!parsed || !Array.isArray(parsed.suggestions)) {
      throw new Error("AI returned an unparseable response.");
    }

    const prevIds = new Set(prev.map((g) => g.id as string));
    const suggestions: SuggestedGoal[] = parsed.suggestions
      .slice(0, 5)
      .map((s) => {
        const metric: Metric = (METRICS as readonly string[]).includes(s.metric_type)
          ? (s.metric_type as Metric)
          : "custom";
        const biz =
          typeof s.business_id === "string" && validBizIds.has(s.business_id)
            ? s.business_id
            : null;
        const carry =
          typeof s.carry_from_id === "string" && prevIds.has(s.carry_from_id)
            ? s.carry_from_id
            : null;
        const target =
          metric === "custom"
            ? null
            : typeof s.target_value === "number" && Number.isFinite(s.target_value)
              ? s.target_value
              : null;
        return {
          title: String(s.title ?? "").slice(0, 200).trim(),
          description:
            typeof s.description === "string" && s.description.trim().length > 0
              ? s.description.slice(0, 500)
              : null,
          metric_type: metric,
          target_value: target,
          business_id: biz,
          carry_from_id: carry,
        };
      })
      .filter((s) => s.title.length > 0);

    // Quietly note business names for clients that want to render them, not required by schema.
    void bizById;

    return { suggestions };
  });
