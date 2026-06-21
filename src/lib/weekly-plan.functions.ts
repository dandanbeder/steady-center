/**
 * AI deferral suggestions for Plan My Week.
 * Gated behind the existing `ai_assistant` (Pro) entitlement.
 *
 * The fallback (no API key, error, bad JSON) is deterministic: lowest priority
 * first, then latest due date, then no-due-date, so the UX never blocks.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { requireFeature } from "@/lib/entitlements.server";
import { routeModel } from "./ai-routing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Reasoning-tier route: planning a week is real synthesis.
const ROUTE = routeModel("weekly_plan");
const MODEL = ROUTE.model;

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type TaskLite = {
  id: string;
  title: string;
  priority: string;
  due_at: string | null;
};

type SuggestResult = {
  defer_task_ids: string[];
  reason: string;
};

const Input = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  business_id: z.string().uuid().nullable().optional(),
  max_defer: z.number().int().min(1).max(10).optional(),
});

export const suggestDeferrals = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<SuggestResult> => {
    const { supabase, userId } = context;
    await requireFeature(supabase, userId, "ai_assistant");

    const max = data.max_defer ?? 3;

    let q = supabase
      .from("tasks")
      .select("id, title, priority, due_at")
      .is("deleted_at", null)
      .neq("status", "done")
      .eq("committed_week", data.week_start);
    if (data.business_id) q = q.eq("business_id", data.business_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const committed = (rows ?? []) as TaskLite[];

    if (committed.length <= max) {
      return { defer_task_ids: [], reason: "Your week looks balanced, no need to trim." };
    }

    const deterministic = fallbackPick(committed, max);

    // Honour the user's coach setting and meter against their AI allowance.
    const { data: prefRow } = await supabase
      .from("ai_prefs")
      .select("coach_style")
      .eq("user_id", userId)
      .maybeSingle();
    const coachStyle = ((prefRow?.coach_style as "warm" | "direct" | "off" | null) ?? "warm");
    if (coachStyle === "off") return deterministic;

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return deterministic;

    try {
      const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
      const { assertAiCredits } = await import("./credits.server");
      await assertAiBudget(userId);
      await assertAiCredits(userId, 1);

      const styleHint =
        coachStyle === "direct"
          ? "Be warm but a touch more direct."
          : "Be warm, supportive, gentle.";
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          system:
            "You are a kind coach helping a busy operator protect their week. " +
            "Return ONLY JSON: { \"defer_task_ids\": string[], \"reason\": string }. " +
            "Pick the LOWEST priority tasks and LATEST due dates first. Never defer 'urgent'. " +
            "The reason should be ONE warm, supportive sentence under 140 chars that frames this as " +
            "protecting their focus, not as failing. No guilt, no 'hustle', no shame. " +
            styleHint,
          messages: [
            {
              role: "user",
              content:
                `Week starting ${data.week_start}. ` +
                `Suggest up to ${max} tasks to gently move back to the backlog from this committed list:\n` +
                JSON.stringify(committed, null, 2),
            },
          ],
        }),
      });
      if (!res.ok) return deterministic;
      const json = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
      try {
        await recordAiUsage(
          userId,
          MODEL,
          json.usage?.input_tokens ?? 0,
          json.usage?.output_tokens ?? 0,
          { actionType: "weekly_plan" },
        );
      } catch {
        /* metering is best-effort */
      }
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const parsed = JSON.parse(cleaned) as Partial<SuggestResult>;
      const ids = Array.isArray(parsed.defer_task_ids)
        ? parsed.defer_task_ids
            .filter((x): x is string => typeof x === "string")
            .filter((id) => committed.some((t) => t.id === id && t.priority !== "urgent"))
            .slice(0, max)
        : [];
      if (ids.length === 0) return deterministic;
      return {
        defer_task_ids: ids,
        reason: typeof parsed.reason === "string" && parsed.reason.length > 0
          ? parsed.reason.slice(0, 200)
          : deterministic.reason,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("UPGRADE_REQUIRED")) throw e;
      return deterministic;
    }
  });

function fallbackPick(tasks: TaskLite[], max: number): SuggestResult {
  const sortable = tasks.filter((t) => t.priority !== "urgent");
  const sorted = [...sortable].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 2;
    const pb = PRIORITY_RANK[b.priority] ?? 2;
    if (pa !== pb) return pb - pa; // low priority first
    // null due dates go last (less time-sensitive → safe to defer)
    if (!a.due_at && !b.due_at) return 0;
    if (!a.due_at) return -1;
    if (!b.due_at) return 1;
    return b.due_at.localeCompare(a.due_at); // latest due first
  });
  const ids = sorted.slice(0, max).map((t) => t.id);
  return {
    defer_task_ids: ids,
    reason:
      ids.length > 0
        ? "Gently sorted by priority and due date, you stay in the driver's seat."
        : "Nothing obvious to defer, your week looks well-shaped.",
  };
}
