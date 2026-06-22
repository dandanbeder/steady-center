import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  business_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable().optional(),
  platform: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  transcript: z.string().max(200000).optional(),
  audio_path: z.string().max(500).optional(),
  keep_recording: z.boolean().optional().default(false),
  // 'note' = manual note, no AI step. 'summarize' = run summary (and transcription if audio_path).
  mode: z.enum(["note", "summarize"]).optional().default("summarize"),
});

const SummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).default([]),
  action_items: z
    .array(
      z.object({
        text: z.string(),
        owner: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

async function transcribeWithWhisper(audioPath: string, ownerId: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");

  // Verify path belongs to caller
  if (!audioPath.startsWith(`${ownerId}/`)) throw new Error("Forbidden audio path");

  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from("meeting-audio")
    .download(audioPath);
  if (dlErr || !blob) throw new Error(`Failed to download audio: ${dlErr?.message ?? "unknown"}`);

  const filename = audioPath.split("/").pop() || "audio.bin";
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whisper error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}

async function summarizeTranscript(transcript: string): Promise<z.infer<typeof SummarySchema>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      {
        role: "system",
        content:
          "You summarize meeting transcripts. Extract a concise 1-3 sentence summary, key decisions made, and concrete action items. For each action item, infer the owner if mentioned (else null) and parse any explicit due date into ISO 8601 UTC (else null).",
      },
      { role: "user", content: transcript.slice(0, 60000) },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "save_meeting_summary",
          description: "Structured meeting summary",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string" },
              decisions: { type: "array", items: { type: "string" } },
              action_items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    owner: { type: ["string", "null"] },
                    due_at: { type: ["string", "null"] },
                  },
                  required: ["text", "owner", "due_at"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "decisions", "action_items"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "save_meeting_summary" } },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const argsRaw = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsRaw) throw new Error("AI returned no structured result");
  return SummarySchema.parse(JSON.parse(argsRaw));
}

export const processMeeting = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "meetings");


    // 1) Always create the meeting row first so the user's input is NEVER lost,
    //    even if a later AI step fails.
    let transcript = (data.transcript ?? "").trim();
    let storedAudioPath: string | null = data.audio_path ?? null;

    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .insert({
        owner_id: userId,
        business_id: data.business_id,
        event_id: data.event_id ?? null,
        platform: data.platform,
        title: data.title,
        transcript,
        summary: "",
        decisions: [],
        audio_path: storedAudioPath,
        keep_recording: data.keep_recording,
      } as never)
      .select("*")
      .single();
    if (mErr || !meeting) throw new Error(mErr?.message ?? "Failed to save meeting");
    const meetingRow = meeting as unknown as { id: string };

    // Manual note: stop here.
    if (data.mode === "note") {
      return { meeting_id: meetingRow.id, ai_error: null as string | null };
    }

    // 2) Best-effort AI: transcribe (if audio) + summarize. Failures are reported,
    //    not thrown — the saved meeting stays intact.
    let ai_error: string | null = null;
    try {
      if (!transcript && storedAudioPath) {
        transcript = (await transcribeWithWhisper(storedAudioPath, userId)).trim();
      }
      if (!transcript) {
        ai_error = "No transcript or audio provided to summarise.";
      } else {
        const result = await summarizeTranscript(transcript);

        // Drop audio unless explicitly kept.
        if (storedAudioPath && !data.keep_recording) {
          if (storedAudioPath.startsWith(`${userId}/`)) {
            await supabaseAdmin.storage.from("meeting-audio").remove([storedAudioPath]);
          }
          storedAudioPath = null;
        }

        await supabase
          .from("meetings")
          .update({
            transcript,
            summary: result.summary,
            decisions: result.decisions,
            audio_path: storedAudioPath,
          } as never)
          .eq("id", meetingRow.id);

        if (result.action_items.length > 0) {
          const rows = result.action_items.map((ai) => ({
            owner_id: userId,
            business_id: data.business_id,
            source_type: "meeting",
            source_id: meetingRow.id,
            text: ai.text,
            owner_label: ai.owner ?? null,
            due_at: ai.due_at ?? null,
          }));
          await supabase.from("action_items").insert(rows as never);
        }
      }
    } catch (e) {
      ai_error = e instanceof Error ? e.message : "AI step failed";
    }

    return { meeting_id: meetingRow.id, ai_error };
  });
