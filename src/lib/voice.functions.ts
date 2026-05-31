import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  transcript: z.string().min(1).max(8000),
  businesses: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .max(50)
    .default([]),
  now: z.string().min(1).max(40),
});

const ResultSchema = z.object({
  business: z.string().nullable(),
  folder: z.string().nullable(),
  note_title: z.string(),
  note_body: z.string(),
  follow_up: z.object({
    title: z.string().nullable(),
    due_at: z.string().nullable(),
  }),
});

export const parseVoiceCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const businessList = data.businesses.length
      ? data.businesses.map((b) => `- ${b.name}`).join("\n")
      : "(none yet)";

    const systemPrompt = `You convert a single voice memo from a busy business owner into a structured note plus optional follow-up task.

Existing businesses:
${businessList}

Rules:
- "business" must EXACTLY match one of the existing business names above, or null if none clearly applies.
- "folder" is a short topical folder name (e.g. "Sales", "Operations", "Pricing"). Reuse common names. Null only if unclear.
- "note_title" is a concise 3-7 word title.
- "note_body" is the cleaned-up note in 1-3 short paragraphs, fixing speech-to-text artifacts but keeping the speaker's voice.
- "follow_up.title" is a short action ("Send proposal to Acme") or null if no clear follow-up.
- "follow_up.due_at" is an ISO 8601 timestamp (UTC), inferred from phrases like "by Friday", "tomorrow", "next week". Today is ${data.now}. Null if no time mentioned.
Return ONLY the structured arguments via the provided tool.`;

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: data.transcript },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "save_voice_capture",
            description: "Structured voice memo result",
            parameters: {
              type: "object",
              properties: {
                business: { type: ["string", "null"] },
                folder: { type: ["string", "null"] },
                note_title: { type: "string" },
                note_body: { type: "string" },
                follow_up: {
                  type: "object",
                  properties: {
                    title: { type: ["string", "null"] },
                    due_at: { type: ["string", "null"] },
                  },
                  required: ["title", "due_at"],
                  additionalProperties: false,
                },
              },
              required: ["business", "folder", "note_title", "note_body", "follow_up"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "save_voice_capture" } },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Rate limited. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = toolCall?.function?.arguments;
    if (!argsRaw) throw new Error("AI returned no structured result");

    const parsed = ResultSchema.parse(JSON.parse(argsRaw));
    return parsed;
  });
