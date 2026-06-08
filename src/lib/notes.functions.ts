import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ATTACHMENT_BUCKET = "note-attachments";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export const extractAttachmentText = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input: unknown) =>
    z.object({ attachmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS-checked read to confirm the caller can see this attachment
    const { data: att, error } = await supabase
      .from("note_attachments")
      .select("id, business_id, storage_path, mime_type, file_name, size_bytes")
      .eq("id", data.attachmentId)
      .single();
    if (error || !att) throw new Error("Attachment not found");
    if (att.size_bytes && att.size_bytes > MAX_BYTES) {
      return { ok: false, reason: "too_large" as const };
    }

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from(ATTACHMENT_BUCKET)
      .download(att.storage_path);
    if (dlErr || !file) throw new Error("Failed to download attachment");

    const mime = (att.mime_type ?? "").toLowerCase();
    const name = (att.file_name ?? "").toLowerCase();
    let text = "";

    try {
      if (mime.includes("pdf") || name.endsWith(".pdf")) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(buf);
        const out = await extractText(pdf, { mergePages: true });
        text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
      } else if (
        mime.includes("officedocument.wordprocessingml") ||
        name.endsWith(".docx")
      ) {
        const buf = Buffer.from(await file.arrayBuffer());
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        text = result.value ?? "";
      } else {
        return { ok: false, reason: "unsupported_type" as const };
      }
    } catch (e) {
      return {
        ok: false,
        reason: "extract_failed" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }

    text = text.trim().slice(0, MAX_TEXT_CHARS);

    const { error: upErr } = await supabaseAdmin
      .from("note_attachments")
      .update({ extracted_text: text })
      .eq("id", att.id);
    if (upErr) throw new Error(upErr.message);

    return { ok: true as const, length: text.length };
  });
