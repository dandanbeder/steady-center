/**
 * "Describe a view" — translates natural language into a Saved View config
 * (view + group_by + filters + sort). Metered against the AI allowance.
 *
 * Returns a draft the user confirms client-side before saving.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

const VIEWS = ["list", "board", "calendar", "timeline"] as const;
const GROUPS = ["stage", "priority", "assignee", "due", "outcome", "business", "none"] as const;
const SORTS = ["priority", "due", "title", "created"] as const;
const PRIORITIES = ["all", "urgent", "high", "normal", "low"] as const;
const STATUSES = ["all", "todo", "in_progress", "review", "done"] as const;
const DUES = ["all", "overdue", "today", "week", "none"] as const;
const ASSIGNED = ["all", "me", "by_me", "unassigned"] as const;

const Input = z.object({ description: z.string().min(3).max(400) });

const Draft = z.object({
  name: z.string().min(1).max(60),
  view: z.enum(VIEWS),
  group_by: z.enum(GROUPS),
  sort: z.object({ key: z.enum(SORTS) }),
  filters: z.object({
    priority: z.enum(PRIORITIES),
    status: z.enum(STATUSES),
    due: z.enum(DUES),
    assigned: z.enum(ASSIGNED),
    outcome: z.string(),
  }),
  rationale: z.string().max(200).optional(),
});

export type ViewDraft = z.infer<typeof Draft>;

export const describeView = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ViewDraft> => {
    const { userId } = context;
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI is not configured");

    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    await assertAiBudget(userId);

    const system =
      "You translate a user's plain-language description into a Tasks view config. " +
      "Respond with ONLY a single JSON object, no prose. Schema:\n" +
      `{ "name": string, "view": one of ${VIEWS.join("|")}, "group_by": one of ${GROUPS.join("|")}, ` +
      `"sort": { "key": one of ${SORTS.join("|")} }, ` +
      `"filters": { "priority": one of ${PRIORITIES.join("|")}, "status": one of ${STATUSES.join("|")}, ` +
      `"due": one of ${DUES.join("|")}, "assigned": one of ${ASSIGNED.join("|")}, "outcome": "all" or "none" }, ` +
      `"rationale": short (<160 chars) explanation }. ` +
      "Use 'all' for any filter the user didn't restrict. Pick a short clear name (2-4 words).";

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
        system,
        messages: [{ role: "user", content: data.description }],
      }),
    });
    if (!res.ok) throw new Error("AI request failed");
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
      );
    } catch {
      /* best effort */
    }

    // Extract JSON (model may wrap in ```json fences)
    const jsonStr =
      text.match(/```json\s*([\s\S]*?)```/i)?.[1] ??
      text.match(/\{[\s\S]*\}/)?.[0] ??
      text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("Could not parse the AI's response — try rephrasing.");
    }
    const result = Draft.safeParse(parsed);
    if (!result.success) {
      throw new Error("AI returned an unexpected shape — try rephrasing.");
    }
    return result.data;
  });
