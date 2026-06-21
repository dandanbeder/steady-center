import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const MODEL = "google/gemini-3-flash-preview";

const Input = z.object({
  range: z.enum(["week", "month"]),
});

export const reflectOnJournal = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured.");
    const { supabase, userId } = context;

    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    await assertAiBudget(userId);

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (data.range === "week" ? 7 : 30));

    // RLS already restricts to owner; we additionally filter for journal type.
    const { data: rows, error } = await supabase
      .from("notes")
      .select("title, body, created_at, note_type")
      .eq("note_type", "journal")
      .is("deleted_at", null)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(60);
    if (error) throw error;

    const entries = (rows ?? []) as Array<{ title: string; body: string; created_at: string }>;
    if (entries.length === 0) {
      return {
        markdown:
          "## A quiet stretch\n\nThere are no entries in this window, and that's completely fine. Come back when you feel like writing.",
        entryCount: 0,
      };
    }

    const corpus = entries
      .map(
        (e) =>
          `### ${new Date(e.created_at).toDateString()}, ${e.title}\n${e.body.slice(0, 1800)}`,
      )
      .join("\n\n---\n\n")
      .slice(0, 40_000);

    const system = `You are a calm, warm reflective companion looking back over the user's PRIVATE journal entries. This is for their eyes only.

Tone: gentle, human, unhurried. Never clinical. Never gamified. No streaks, no scores, no "you should". No diagnoses or medical language. Use second person ("you") softly.

Goal: help the user notice patterns and feel seen.

Structure the reflection as concise markdown:
- "## Themes you returned to", 2-4 short bullets
- "## Small wins", 1-3 bullets (only what the entries actually evidence)
- "## What you seemed to be carrying", 1-3 bullets, compassionately worded
- "## A gentle question to sit with", one open question

Rules:
- Quote sparingly (≤8 words) and only if it helps.
- If the corpus is thin, say so kindly and keep it short.
- Never invent events. Never moralise. Never give advice unless asked.`;

    const userMsg = `Window: last ${data.range === "week" ? "7" : "30"} days. ${entries.length} entries.\n\n${corpus}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      if (res.status === 429) throw new Error("Rate limited, try again shortly.");
      throw new Error(`AI call failed (${res.status}). ${t.slice(0, 120)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const markdown =
      json.choices?.[0]?.message?.content?.trim() ??
      "_(no reflection generated, try again later)_";

    await recordAiUsage(
      userId,
      MODEL,
      json.usage?.prompt_tokens ?? 0,
      json.usage?.completion_tokens ?? 0,
      { actionType: "journal_reflect" },
    ).catch(() => undefined);

    return { markdown, entryCount: entries.length };
  });
