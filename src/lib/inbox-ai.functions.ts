import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  inbox_id: z.string().uuid(),
  now: z.string().min(1).max(40),
});

export const suggestInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
    const { supabase } = context;

    // Load the item (RLS scoped to user)
    const { data: item, error: itemErr } = await (supabase.from("inbox_items" as never) as any)
      .select("id, raw_text, status")
      .eq("id", data.inbox_id)
      .single();
    if (itemErr) throw itemErr;
    if (!item) throw new Error("Inbox item not found");
    if (item.status !== "pending") return { ok: true, skipped: true };

    // Load context: businesses + folders + lists (RLS scoped)
    const [bizRes, folderRes, listRes] = await Promise.all([
      (supabase.from("businesses") as any).select("id, name").limit(100),
      (supabase.from("folders") as any).select("id, name, business_id").is("deleted_at", null).limit(300),
      (supabase.from("lists") as any).select("id, name, folder_id").is("deleted_at", null).limit(300),
    ]);
    const businesses = (bizRes.data ?? []) as { id: string; name: string }[];
    const folders = (folderRes.data ?? []) as { id: string; name: string; business_id: string }[];
    const lists = (listRes.data ?? []) as { id: string; name: string; folder_id: string }[];

    const bizLines = businesses.length
      ? businesses.map((b) => `- ${b.id} :: ${b.name}`).join("\n")
      : "(none)";
    const folderLines = folders.length
      ? folders.map((f) => `- ${f.id} :: ${f.name} (biz=${f.business_id})`).join("\n")
      : "(none)";
    const listLines = lists.length
      ? lists.map((l) => `- ${l.id} :: ${l.name} (folder=${l.folder_id})`).join("\n")
      : "(none)";

    const system = `You triage a single inbox capture from a busy business owner into a structured suggestion.
Now: ${data.now}

Existing accounts (id :: name):
${bizLines}

Existing folders (id :: name (biz=...)):
${folderLines}

Existing lists (id :: name (folder=...)):
${listLines}

Rules:
- Decide "type": "task" (an action with possible due date), "note" (information to remember), or "event" (something scheduled at a specific time).
- "title" is 3-8 words, action-oriented for tasks.
- "body" is the cleaned-up content (fix transcription artifacts but keep voice). Short.
- "business_id" / "folder_id" / "list_id" must EXACTLY match an existing id above, or null. Prefer existing matches; only suggest null if nothing clearly fits.
- "priority" only for tasks: low | normal | high | urgent.
- "due_at" ISO 8601 only if a time is clearly implied (e.g. "by Friday", "tomorrow at 3pm"); otherwise null.
Return ONLY the structured arguments via the provided tool.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: item.raw_text },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_inbox",
            description: "Structured triage suggestion",
            parameters: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["task", "note", "event"] },
                title: { type: "string" },
                body: { type: "string" },
                business_id: { type: ["string", "null"] },
                folder_id: { type: ["string", "null"] },
                list_id: { type: ["string", "null"] },
                priority: { type: ["string", "null"], enum: ["low", "normal", "high", "urgent", null] },
                due_at: { type: ["string", "null"] },
              },
              required: ["type", "title", "body", "business_id", "folder_id", "list_id", "priority", "due_at"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_inbox" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limited.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI error: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    if (!args) throw new Error("AI returned no suggestion");

    const patch = {
      suggested_type: args.type,
      suggested_title: args.title ?? null,
      suggested_body: args.body ?? null,
      suggested_business_id: args.business_id ?? null,
      suggested_folder_id: args.folder_id ?? null,
      suggested_list_id: args.list_id ?? null,
      suggested_priority: args.priority ?? null,
      suggested_due_at: args.due_at ?? null,
      ai_processed_at: new Date().toISOString(),
      ai_raw: args,
    };

    const { error: updErr } = await (supabase.from("inbox_items" as never) as any)
      .update(patch)
      .eq("id", data.inbox_id);
    if (updErr) throw updErr;

    return { ok: true, suggestion: patch };
  });
