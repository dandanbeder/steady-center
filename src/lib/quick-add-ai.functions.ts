import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const InputSchema = z.object({
  text: z.string().min(1).max(2000),
  now: z.string().min(1).max(40),
  timezone: z.string().min(1).max(80).optional(),
});

const SuggestionSchema = z.object({
  type: z.enum(["event", "task", "meeting"]),
  title: z.string().min(1).max(200),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  all_day: z.boolean().nullable(),
  business_id: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullable(),
  join_url: z.string().nullable(),
  reasoning: z.string().max(280).nullable(),
});

export type QuickAddSuggestion = z.infer<typeof SuggestionSchema>;

/**
 * Interpret a natural-language phrase from the Calendar Quick Add bar and
 * return a structured suggestion (event / task / meeting) for user confirmation.
 *
 * RLS: businesses list is read with the user's RLS-scoped supabase client.
 * Nothing is written here, the caller persists the chosen entity after confirmation.
 */
export const interpretQuickAdd = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { assertAiCredits } = await import("./credits.server");
    await assertAiCredits(context.userId, 1);

    const { supabase } = context;
    const { data: bizRows } = await (supabase.from("businesses") as never as {
      select: (q: string) => Promise<{ data: { id: string; name: string }[] | null }>;
    }).select("id, name");
    const businesses = bizRows ?? [];
    const bizLines = businesses.length
      ? businesses.map((b) => `- ${b.id} :: ${b.name}`).join("\n")
      : "(none, user only has the Personal space)";

    const system = `You interpret a single short phrase from a calendar Quick Add bar and decide what to create.

Now: ${data.now}${data.timezone ? `\nTimezone: ${data.timezone}` : ""}

Existing accounts/spaces (id :: name):
${bizLines}

Decide "type":
- "event": something scheduled at a specific time that is NOT a video/phone call with another party (e.g. "lunch with Sam Friday 1pm", "gym tomorrow 7am", "school pickup 3pm").
- "meeting": a call/conversation with one or more other people, OR contains a video platform name/URL (Zoom, Teams, Google Meet, "call", "meeting with", "1:1", "sync with"). Examples: "Zoom call with Acme Tuesday", "1:1 with Priya Wednesday 4pm".
- "task": an action item with no specific meeting time (e.g. "email the accountant", "renew domain by Friday", "follow up with supplier"). May have a due date but no start/end time.

Rules:
- "title" is 3-8 words, cleaned up. Strip filler words like "remind me to", "i need to".
- For event/meeting: "start_at" and "end_at" ISO 8601 UTC, parsed relative to Now. Default duration: 30min for meetings, 60min for events. If only a date (no time) is given, set "all_day": true and pick start_at = 09:00 local, end_at = end of day.
- For task: "start_at" and "end_at" must be null and "all_day" null. If a due date is implied (e.g. "by Friday", "tomorrow"), put it in "start_at" as ISO 8601 (this is treated as due_at). Otherwise null.
- "business_id" must EXACTLY match an existing id above, or null (Personal). Pick a match only if the phrase clearly references that account by name.
- "priority" only for tasks: low | normal | high | urgent. Use "high" for "urgent", "asap", "important". Otherwise "normal" or null.
- "join_url" only if the phrase literally contains an http(s) URL, never invent one.
- "reasoning" is one short sentence explaining the type choice (max 200 chars).

Return ONLY via the provided tool.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "quick_add",
              description: "Structured Quick Add interpretation",
              parameters: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["event", "task", "meeting"] },
                  title: { type: "string" },
                  start_at: { type: ["string", "null"] },
                  end_at: { type: ["string", "null"] },
                  all_day: { type: ["boolean", "null"] },
                  business_id: { type: ["string", "null"] },
                  priority: {
                    type: ["string", "null"],
                    enum: ["low", "normal", "high", "urgent", null],
                  },
                  join_url: { type: ["string", "null"] },
                  reasoning: { type: ["string", "null"] },
                },
                required: [
                  "type",
                  "title",
                  "start_at",
                  "end_at",
                  "all_day",
                  "business_id",
                  "priority",
                  "join_url",
                  "reasoning",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "quick_add" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limited. Try again shortly.");
      if (res.status === 402)
        throw new Error("AI credits exhausted, pick the type manually.");
      throw new Error(`AI error: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const argsRaw = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsRaw) throw new Error("AI returned no suggestion");
    const suggestion = SuggestionSchema.parse(JSON.parse(argsRaw));

    try {
      const { recordAiUsage } = await import("./ai-budget.server");
      await recordAiUsage(
        context.userId,
        "google/gemini-3-flash-preview",
        json.usage?.prompt_tokens ?? 0,
        json.usage?.completion_tokens ?? 0,
        { actionType: "other" },
      );
    } catch {
      /* never break the user-facing call */
    }

    return suggestion;
  });
