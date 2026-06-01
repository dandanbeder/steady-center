import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_INPUT_CHARS = 60_000;

type AnthropicResponse = { content?: Array<{ type: string; text?: string }> };

async function callClaude(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
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
      max_tokens: opts.maxTokens ?? 1600,
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
  return j.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}

function parseJsonBlock<T>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Try to grab first JSON object if extra prose
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

async function loadNoteContext(
  supabase: any,
  noteId: string,
  includeAttachments: boolean,
): Promise<{
  note: {
    id: string;
    title: string;
    body: string;
    business_id: string | null;
    folder_id: string | null;
  };
  attachmentsText: string;
}> {
  const { data: note, error } = await supabase
    .from("notes")
    .select("id,title,body,business_id,folder_id")
    .eq("id", noteId)
    .single();
  if (error || !note) throw new Error("Note not found");

  let attachmentsText = "";
  if (includeAttachments) {
    const { data: atts } = await supabase
      .from("note_attachments")
      .select("file_name, extracted_text")
      .eq("note_id", noteId);
    const parts: string[] = [];
    for (const a of (atts ?? []) as Array<{
      file_name: string;
      extracted_text: string | null;
    }>) {
      if (!a.extracted_text) continue;
      parts.push(`--- Attachment: ${a.file_name} ---\n${a.extracted_text}`);
    }
    attachmentsText = parts.join("\n\n").slice(0, MAX_INPUT_CHARS);
  }
  return { note, attachmentsText };
}

// =================================================================
// 1. Summarize note (+ optional attachments)
// =================================================================
export const summarizeNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        noteId: z.string().uuid(),
        includeAttachments: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { note, attachmentsText } = await loadNoteContext(
      context.supabase,
      data.noteId,
      data.includeAttachments,
    );
    const sys = `You produce concise, faithful summaries of personal/work notes.
Return MARKDOWN with two sections:
## Key points
- bullet list of the most important facts/ideas (max 8 bullets)
## Decisions
- bullet list of explicit or implied decisions (max 6 bullets, or "None recorded.")
Be specific. Do not invent facts. Quote names/dates verbatim when present.`;
    const user = `Title: ${note.title || "Untitled"}\n\nNote body:\n${note.body || "(empty)"}${
      attachmentsText ? `\n\nAttachments:\n${attachmentsText}` : ""
    }`;
    const text = await callClaude({ system: sys, user, maxTokens: 1200 });
    return { markdown: text };
  });

// =================================================================
// 2. Organize brain dump → clean structured note
// =================================================================
export const organizeBrainDump = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ rawText: z.string().min(1).max(MAX_INPUT_CHARS) }).parse(i),
  )
  .handler(async ({ data }) => {
    const sys = `You turn messy brain-dumps (typed or dictated) into a clean, structured note.
Return ONLY JSON matching this shape:
{
  "title": "concise 3-7 word title",
  "body_markdown": "the full cleaned note in markdown",
  "checklist": ["actionable item", "..."]
}
Rules:
- body_markdown should use ## headings to group ideas into sensible sections.
- Preserve every fact; do not invent.
- Fix grammar/clarity but keep the author's voice.
- checklist: 0-10 atomic to-do items pulled from the text (verb-led).`;
    const text = await callClaude({
      system: sys,
      user: data.rawText,
      maxTokens: 2000,
    });
    const parsed = parseJsonBlock<{
      title: string;
      body_markdown: string;
      checklist: string[];
    }>(text);
    if (!parsed) throw new Error("AI returned an unparseable response.");
    return parsed;
  });

// =================================================================
// 3. Suggest title, folder, people
// =================================================================
export const suggestNoteMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ noteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { note } = await loadNoteContext(supabase, data.noteId, false);

    // Pull candidate folders + members for the note's business
    let folders: { id: string; name: string }[] = [];
    let members: { email: string; full_name: string | null }[] = [];
    if (note.business_id) {
      const { data: f } = await supabase
        .from("folders")
        .select("id,name")
        .eq("business_id", note.business_id);
      folders = f ?? [];
      const { data: m } = await supabase.rpc("list_business_members", {
        p_business: note.business_id,
      });
      members = ((m ?? []) as Array<{ email: string; full_name: string | null }>).filter(
        (x) => x.email,
      );
    }

    const sys = `You suggest metadata for a note. Return ONLY JSON:
{
  "title": "3-7 word title that captures the note",
  "folder": { "id": "uuid or null", "name": "existing folder name OR a suggested new one" },
  "people": ["email1@example.com", "..."]
}
- title: improve only if better than current; otherwise echo current.
- folder.id: pick an existing folder UUID from the candidates if a good fit exists; otherwise null with a suggested new name.
- people: list emails (lowercased) of people clearly mentioned in the body. Prefer emails from candidates; include any other email patterns found verbatim. Max 6.`;

    const user = `Current title: ${note.title || "(none)"}
Body:
${note.body || "(empty)"}

Candidate folders (id — name):
${folders.map((f) => `${f.id} — ${f.name}`).join("\n") || "(none)"}

Candidate members:
${members.map((m) => `${m.email}${m.full_name ? ` (${m.full_name})` : ""}`).join("\n") || "(none)"}`;

    const text = await callClaude({ system: sys, user, maxTokens: 800 });
    const parsed = parseJsonBlock<{
      title: string;
      folder: { id: string | null; name: string };
      people: string[];
    }>(text);
    if (!parsed) throw new Error("AI returned an unparseable response.");
    return parsed;
  });

// =================================================================
// 4. Extract action items
// =================================================================
export const extractActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ noteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { note, attachmentsText } = await loadNoteContext(
      context.supabase,
      data.noteId,
      true,
    );
    const today = new Date().toISOString().slice(0, 10);
    const sys = `You extract concrete action items from a note.
Return ONLY JSON: { "actions": [{ "title": string, "due_at": "YYYY-MM-DD" | null, "priority": "urgent"|"high"|"normal"|"low" }] }
Rules:
- 0-12 atomic tasks, verb-led titles ("Send proposal to Acme").
- due_at: extract when explicit ("by Friday", "next Tue"); else null. Today is ${today}. Resolve relative dates to absolute YYYY-MM-DD.
- priority: infer from urgency cues; default "normal".
- Do not invent tasks. Skip vague aspirations.`;
    const user = `Title: ${note.title || "Untitled"}\n\nBody:\n${note.body}${
      attachmentsText ? `\n\nAttachments:\n${attachmentsText}` : ""
    }`;
    const text = await callClaude({ system: sys, user, maxTokens: 1200 });
    const parsed = parseJsonBlock<{
      actions: Array<{
        title: string;
        due_at: string | null;
        priority: "urgent" | "high" | "normal" | "low";
      }>;
    }>(text);
    if (!parsed || !Array.isArray(parsed.actions)) {
      throw new Error("AI returned an unparseable response.");
    }
    // Normalize due_at to ISO at 9am local-ish (UTC noon as safe default)
    const actions = parsed.actions.slice(0, 20).map((a) => ({
      title: String(a.title).slice(0, 200),
      due_at: a.due_at ? `${a.due_at}T12:00:00.000Z` : null,
      priority: (["urgent", "high", "normal", "low"] as const).includes(a.priority)
        ? a.priority
        : ("normal" as const),
    }));
    return { actions };
  });

// =================================================================
// 5. Guide me — concrete next steps + optional subtasks
// =================================================================
export const guideMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ noteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { note, attachmentsText } = await loadNoteContext(
      context.supabase,
      data.noteId,
      true,
    );
    const sys = `You coach a busy operator. Read the note and propose what to do next.
Return ONLY JSON:
{
  "next_steps_markdown": "3-6 concrete next steps as a markdown numbered list, each starting with a verb",
  "big_item": { "title": "the single largest item that should be broken down, or null", "subtasks": [{ "title": string, "due_at": "YYYY-MM-DD" | null }] }
}
If nothing is big enough to break down, set big_item to null. Max 6 subtasks. Be specific and grounded in the note.`;
    const user = `Title: ${note.title || "Untitled"}\n\nBody:\n${note.body}${
      attachmentsText ? `\n\nAttachments:\n${attachmentsText}` : ""
    }`;
    const text = await callClaude({ system: sys, user, maxTokens: 1400 });
    const parsed = parseJsonBlock<{
      next_steps_markdown: string;
      big_item: { title: string; subtasks: Array<{ title: string; due_at: string | null }> } | null;
    }>(text);
    if (!parsed) throw new Error("AI returned an unparseable response.");
    return parsed;
  });

// =================================================================
// 6. Voice clean-up (wrapper around organizeBrainDump for clarity)
// =================================================================
export const cleanupTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ transcript: z.string().min(1).max(MAX_INPUT_CHARS) }).parse(i),
  )
  .handler(async ({ data }) => {
    const sys = `You clean up a voice-dictated transcript into readable markdown.
Return ONLY JSON: { "title": string, "body_markdown": string }
- Fix punctuation, capitalization, paragraph breaks, obvious speech errors.
- Preserve every fact and the speaker's voice.
- Add a brief 3-6 word title.`;
    const text = await callClaude({
      system: sys,
      user: data.transcript,
      maxTokens: 1800,
    });
    const parsed = parseJsonBlock<{ title: string; body_markdown: string }>(text);
    if (!parsed) throw new Error("AI returned an unparseable response.");
    return parsed;
  });
