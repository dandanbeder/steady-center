import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  business_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable().optional(),
  // Platform is auto-detected from join_url when present; manual fallback only.
  platform: z.string().min(1).max(40),
  join_url: z.string().url().max(2000).nullable().optional(),
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

// Deprecated: platform is now derived from a join URL via detectPlatformFromUrl.
// Kept as a fallback for events with no extractable URL (e.g. in-person bookings).
function fallbackPlatformFromEvent(location: string | null): string {
  if (location && !/https?:\/\//i.test(location)) return "in_person";
  return "other";
}

export const createMeetingFromEvent = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "meetings");

    // RLS already restricts to owner_id = auth.uid(); we also verify explicitly.
    const { data: event, error: eErr } = await supabase
      .from("events")
      .select("id, owner_id, business_id, title, start_at, location, description, attendees")
      .eq("id", data.event_id)
      .maybeSingle();
    if (eErr || !event) throw new Error("Event not found");
    const ev = event as unknown as {
      id: string;
      owner_id: string;
      business_id: string | null;
      title: string;
      start_at: string;
      location: string | null;
      description: string | null;
      attendees: unknown;
    };
    if (ev.owner_id !== userId) throw new Error("Forbidden");

    // Reuse if a meeting already exists for this event.
    const { data: existing } = await supabase
      .from("meetings")
      .select("id")
      .eq("event_id", ev.id)
      .maybeSingle();
    if (existing) {
      return { meeting_id: (existing as { id: string }).id, reused: true };
    }

    const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
    const { extractJoinUrl, detectPlatformFromUrl } = await import("./meeting-platform");
    const joinUrl = extractJoinUrl(ev.location, ev.description);
    const platform = joinUrl
      ? detectPlatformFromUrl(joinUrl).id
      : fallbackPlatformFromEvent(ev.location);

    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .insert({
        owner_id: userId,
        business_id: ev.business_id, // space mapped to the calendar
        event_id: ev.id,
        platform,
        join_url: joinUrl,
        title: ev.title,
        transcript: "",
        summary: "",
        decisions: [],
        attendees,
        scheduled_at: ev.start_at,
      } as never)
      .select("id")
      .single();
    if (mErr || !meeting) throw new Error(mErr?.message ?? "Failed to create meeting");
    return { meeting_id: (meeting as { id: string }).id, reused: false };
  });


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

// ============================================================
// User-invoked AI: generate a DRAFT (no DB writes besides storing a
// freshly-produced transcript when audio is present). The user reviews,
// edits, then confirms via applyMeetingDraft.
// ============================================================

export const generateMeetingDraft = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) =>
    z.object({ meeting_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "meetings");

    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .select("id, owner_id, transcript, audio_path")
      .eq("id", data.meeting_id)
      .maybeSingle();
    if (mErr || !meeting) throw new Error("Meeting not found");
    const m = meeting as unknown as {
      id: string;
      owner_id: string;
      transcript: string | null;
      audio_path: string | null;
    };
    if (m.owner_id !== userId) throw new Error("Forbidden");

    let transcript = (m.transcript ?? "").trim();
    if (!transcript && m.audio_path) {
      transcript = (await transcribeWithWhisper(m.audio_path, userId)).trim();
      // Persist the new transcript so re-runs don't re-transcribe.
      if (transcript) {
        await supabase
          .from("meetings")
          .update({ transcript } as never)
          .eq("id", m.id);
      }
    }
    if (!transcript) {
      throw new Error("No transcript or audio to summarise.");
    }

    const result = await summarizeTranscript(transcript);
    return {
      summary: result.summary,
      decisions: result.decisions,
      action_items: result.action_items,
    };
  });

// Confirm: writes summary, decisions, action_items, and creates real tasks.
const ApplyInput = z.object({
  meeting_id: z.string().uuid(),
  summary: z.string().max(20000),
  decisions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        outcome_id: z.string().uuid().nullable().optional(),
      }),
    )
    .max(50),
  tasks: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        owner_label: z.string().max(120).nullable().optional(),
        due_at: z.string().nullable().optional(),
        business_id: z.string().uuid().nullable().optional(),
        list_id: z.string().uuid().nullable().optional(),
        outcome_id: z.string().uuid().nullable().optional(),
      }),
    )
    .max(50),
});

export const applyMeetingDraft = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => ApplyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify ownership.
    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .select("id, owner_id, business_id")
      .eq("id", data.meeting_id)
      .maybeSingle();
    if (mErr || !meeting) throw new Error("Meeting not found");
    const m = meeting as unknown as { id: string; owner_id: string; business_id: string | null };
    if (m.owner_id !== userId) throw new Error("Forbidden");

    // 1) Update summary + decisions array on meetings (keep legacy text[] in sync).
    await supabase
      .from("meetings")
      .update({
        summary: data.summary,
        decisions: data.decisions.map((d) => d.text),
      } as never)
      .eq("id", m.id);

    // 2) Replace meeting_decisions rows.
    await supabase.from("meeting_decisions").delete().eq("meeting_id", m.id);
    if (data.decisions.length > 0) {
      const rows = data.decisions.map((d) => ({
        meeting_id: m.id,
        owner_id: userId,
        text: d.text,
        outcome_id: d.outcome_id ?? null,
      }));
      const { error } = await supabase.from("meeting_decisions").insert(rows as never);
      if (error) throw new Error(error.message);
    }

    // 3) Replace action_items + their linked tasks for this meeting.
    // Remove previously created tasks generated from this meeting.
    const { data: oldAis } = await supabase
      .from("action_items")
      .select("id, task_id")
      .eq("source_type", "meeting")
      .eq("source_id", m.id);
    const oldTaskIds = (oldAis ?? [])
      .map((a: { task_id: string | null }) => a.task_id)
      .filter((v): v is string => !!v);
    if (oldTaskIds.length > 0) {
      await supabase.from("tasks").delete().in("id", oldTaskIds);
    }
    await supabase
      .from("action_items")
      .delete()
      .eq("source_type", "meeting")
      .eq("source_id", m.id);

    // 4) Create real tasks + action_items linked back to the meeting.
    const created: { task_id: string; action_item_id: string }[] = [];
    for (const t of data.tasks) {
      const businessId = t.business_id ?? m.business_id ?? null;
      const { data: task, error: tErr } = await supabase
        .from("tasks")
        .insert({
          owner_id: userId,
          list_id: t.list_id ?? null,
          business_id: businessId,
          title: t.text,
          description: `From meeting: ${m.id}`,
          status: "todo",
          priority: "normal",
          due_at: t.due_at ?? null,
          outcome_id: t.outcome_id ?? null,
        } as never)
        .select("id")
        .single();
      if (tErr || !task) throw new Error(tErr?.message ?? "Failed to create task");
      const taskRow = task as unknown as { id: string };

      const { data: ai, error: aErr } = await supabase
        .from("action_items")
        .insert({
          owner_id: userId,
          business_id: businessId,
          source_type: "meeting",
          source_id: m.id,
          text: t.text,
          owner_label: t.owner_label ?? null,
          due_at: t.due_at ?? null,
          task_id: taskRow.id,
        } as never)
        .select("id")
        .single();
      if (aErr || !ai) throw new Error(aErr?.message ?? "Failed to create action item");
      created.push({ task_id: taskRow.id, action_item_id: (ai as unknown as { id: string }).id });
    }

    return { ok: true, created_count: created.length };
  });

