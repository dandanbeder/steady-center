/**
 * AI deferral suggestions for Plan My Week.
 * Gated behind the existing `ai_assistant` (Pro) entitlement.
 *
 * The fallback (no API key, error, bad JSON) is deterministic: lowest priority
 * first, then latest due date, then no-due-date — so the UX never blocks.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireFeature } from "@/lib/entitlements.server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";

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
  .middleware([requireSupabaseAuth])
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
      return { defer_task_ids: [], reason: "Your commitment already looks balanced." };
    }

    const deterministic = fallbackPick(committed, max);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return deterministic;

    try {
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
            "You help a busy operator trim an overloaded weekly commitment. " +
            "Return ONLY JSON: { \"defer_task_ids\": string[], \"reason\": string }. " +
            "Pick the LOWEST priority tasks and the LATEST due dates first. Never defer 'urgent'. " +
            "Keep the reason to ONE supportive sentence under 140 chars.",
          messages: [
            {
              role: "user",
              content:
                `Week starting ${data.week_start}. ` +
                `Suggest up to ${max} tasks to move back to the backlog from this committed list:\n` +
                JSON.stringify(committed, null, 2),
            },
          ],
        }),
      });
      if (!res.ok) return deterministic;
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
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
    } catch {
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
        ? "Suggested by priority and due date — you decide what stays."
        : "Nothing safe to defer automatically.",
  };
}
