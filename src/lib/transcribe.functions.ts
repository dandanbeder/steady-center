import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

// Server-side Whisper-equivalent transcription via the Lovable AI Gateway.
// Auth is enforced by requireActiveUser; the gateway key never reaches the
// client. No DB writes, so RLS is not engaged for this fn, the auth gate
// is the access control.
const Input = z.object({
  audio_base64: z.string().min(32).max(10_000_000), // ~7.5MB binary cap
  mime: z.string().min(3).max(100),
});

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured.");

    const mime = data.mime.split(";")[0].trim().toLowerCase();
    const ext = EXT[mime] ?? "webm";

    const binary = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([binary], { type: mime });

    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", blob, `recording.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits to keep transcribing.");
      if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
      if (res.status === 400) throw new Error("Couldn't transcribe that recording, try again.");
      throw new Error(`Transcription failed (${res.status}). ${body.slice(0, 120)}`);
    }
    const json = (await res.json()) as { text?: string; duration?: number };
    // Estimate audio duration: prefer API-reported, fall back to byte-rate guess
    // (~16kbps for opus/aac) so the ledger has something usable.
    const audioSeconds = Math.max(
      1,
      Math.round(json.duration ?? binary.byteLength / 2000),
    );
    try {
      const { logAiUsageEvent } = await import("./ai-budget.server");
      await logAiUsageEvent({
        userId: context.userId,
        actionType: "transcribe",
        model: "openai/gpt-4o-mini-transcribe",
        audioSeconds,
        creditsCharged: Math.max(1, Math.ceil(audioSeconds / 60)),
      });
    } catch {
      /* never break the user-facing call */
    }
    return { text: (json.text ?? "").trim() };
  });
