import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 6;

// ---------- Tool catalog (read + propose only; no writes here) ----------
const TOOLS = [
  {
    name: "search_tasks",
    description:
      "Search the current user's tasks. Returns at most 25. Use this to answer questions about what is on the user's plate, overdue items, etc.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on task title." },
        status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
        due_before: { type: "string", description: "ISO timestamp upper bound for due_at." },
        due_after: { type: "string", description: "ISO timestamp lower bound for due_at." },
        overdue: { type: "boolean", description: "Only return non-done tasks whose due_at is in the past." },
      },
    },
  },
  {
    name: "search_events",
    description: "Search the user's calendar events between two ISO timestamps. Returns at most 50.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        from: { type: "string", description: "ISO timestamp (inclusive)." },
        to: { type: "string", description: "ISO timestamp (exclusive)." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "search_notes",
    description: "Search the user's notes by title/body substring. Returns at most 15 with snippets.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "search_meetings",
    description: "Search meeting summaries/transcripts. Returns at most 10.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "list_lists",
    description: "List the user's task lists (id + name). Use before proposing create_task when no list is specified.",
    input_schema: { type: "object", properties: {} },
  },
  // Propose-only tools (NEVER mutate; surface a confirmation card to the user)
  {
    name: "propose_create_task",
    description:
      "Propose creating a new task. The action is NOT applied, it is shown to the user for confirmation. Provide list_id when known.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        list_id: { type: "string" },
        due_at: { type: "string" },
        priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "propose_complete_task",
    description: "Propose marking a task as done. Requires the task id from search_tasks.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "propose_edit_task",
    description: "Propose editing a task's title/due/priority. Only include fields to change.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        due_at: { type: "string" },
        priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
      },
      required: ["task_id"],
    },
  },
  {
    name: "propose_create_note",
    description: "Propose creating a new note.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        folder_id: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "propose_create_event",
    description: "Propose creating a calendar event.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start_at: { type: "string" },
        end_at: { type: "string" },
        calendar_id: { type: "string" },
      },
      required: ["title", "start_at", "end_at"],
    },
  },
  {
    name: "propose_move_event",
    description: "Propose moving an existing event to a new start (and optional end) time.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        start_at: { type: "string" },
        end_at: { type: "string" },
      },
      required: ["event_id", "start_at"],
    },
  },
] as const;

type Proposal = {
  id: string;
  type: string;
  payload: Record<string, any>;
  summary: string;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function describeProposal(type: string, p: Record<string, any>): string {
  switch (type) {
    case "propose_create_task":
      return `Create task: ${p.title}${p.due_at ? ` (due ${p.due_at})` : ""}${p.priority ? ` [${p.priority}]` : ""}`;
    case "propose_complete_task":
      return `Mark task ${p.task_id} as done`;
    case "propose_edit_task":
      return `Edit task ${p.task_id}`;
    case "propose_create_note":
      return `Create note: ${p.title}`;
    case "propose_create_event":
      return `Create event: ${p.title} at ${p.start_at}`;
    case "propose_move_event":
      return `Move event ${p.event_id} to ${p.start_at}`;
    default:
      return type;
  }
}

// ---------- Tool executors (read-only) ----------
async function execReadTool(
  name: string,
  input: any,
  supabase: any,
  businessId: string | null,
): Promise<unknown> {
  const scope = <T extends { eq: (k: string, v: string) => T }>(q: T) =>
    businessId ? q.eq("business_id", businessId) : q;

  switch (name) {
    case "search_tasks": {
      let q: any = supabase.from("tasks").select("id,title,status,priority,due_at,list_id,business_id").is("deleted_at", null).limit(25);
      if (input?.query) q = q.ilike("title", `%${input.query}%`);
      if (input?.status) q = q.eq("status", input.status);
      if (input?.due_before) q = q.lte("due_at", input.due_before);
      if (input?.due_after) q = q.gte("due_at", input.due_after);
      if (input?.overdue) q = q.neq("status", "done").lt("due_at", new Date().toISOString()).not("due_at", "is", null);
      q = scope(q);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    }
    case "search_events": {
      let q: any = supabase
        .from("events")
        .select("id,title,start_at,end_at,calendar_id,business_id,is_meeting")
        .is("deleted_at", null)
        .gte("start_at", input.from)
        .lt("start_at", input.to)
        .order("start_at")
        .limit(50);
      if (input?.query) q = q.ilike("title", `%${input.query}%`);
      q = scope(q);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    }
    case "search_notes": {
      let q: any = supabase
        .from("notes")
        .select("id,title,body,folder_id,business_id,updated_at")
        .is("deleted_at", null)
        .or(`title.ilike.%${input.query}%,body.ilike.%${input.query}%`)
        .order("updated_at", { ascending: false })
        .limit(15);
      q = scope(q);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((n: any) => ({
        ...n,
        body: typeof n.body === "string" ? n.body.slice(0, 600) : n.body,
      }));
    }
    case "search_meetings": {
      let q: any = (supabase.from("meetings" as any) as any)
        .select("id,title,summary,decisions,created_at,business_id")
        .or(`title.ilike.%${input.query}%,summary.ilike.%${input.query}%,transcript.ilike.%${input.query}%`)
        .order("created_at", { ascending: false })
        .limit(10);
      if (businessId) q = q.eq("business_id", businessId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    }
    case "list_lists": {
      const { data, error } = await supabase
        .from("lists")
        .select("id,name,folder_id,folders!inner(business_id,name)")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const filtered = businessId
        ? rows.filter((r) => r.folders?.business_id === businessId)
        : rows;
      return filtered.map((r) => ({ id: r.id, name: r.name, folder: r.folders?.name }));
    }
    default:
      return { error: `Unknown read tool: ${name}` };
  }
}

// ---------- Anthropic call ----------
type AnthropicMsg = {
  role: "user" | "assistant";
  content: any;
};

type ChatTurn = { role: "user" | "assistant"; content: string };

async function callClaude(messages: AnthropicMsg[], system: string): Promise<any> {
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
      max_tokens: 1500,
      system,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Anthropic error", res.status, t.slice(0, 500));
    throw new Error(`AI call failed (${res.status})`);
  }
  return res.json();
}

// =================================================================
// chat, main assistant turn (tool loop, proposes writes)
// =================================================================
export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(8000),
            }),
          )
          .min(1)
          .max(30),
        businessId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(context.supabase, context.userId, "ai_assistant");
    const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
    await assertAiBudget(context.userId);


    const businessId = data.businessId ?? null;
    const now = new Date().toISOString();
    const system = `You are Heartbeat Assistant, a focused productivity copilot.
Today: ${now}. Active account scope: ${businessId ? `business_id=${businessId}` : "ALL accounts"}.
Use the provided tools to look up the user's tasks, events, notes and meeting summaries before answering.
When the user wants to create, edit, complete or move something, ALWAYS use the propose_* tools, these surface
a preview card the user must approve in the UI. NEVER claim that you have written or changed data; only the
user can approve a proposal. Keep answers concise (markdown ok). If a tool returns no rows, say so plainly.`;

    const messages: AnthropicMsg[] = data.history.map((t) => ({ role: t.role, content: t.content }));
    const proposals: Proposal[] = [];
    let totalIn = 0;
    let totalOut = 0;
    let finalText = "";

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const resp = await callClaude(messages, system);
      totalIn += resp.usage?.input_tokens ?? 0;
      totalOut += resp.usage?.output_tokens ?? 0;
      const blocks = (resp.content ?? []) as any[];
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const textBlocks = blocks.filter((b) => b.type === "text");
      if (textBlocks.length) finalText = textBlocks.map((b) => b.text).join("\n").trim();

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

      // Append assistant turn verbatim, then build tool_result user turn
      messages.push({ role: "assistant", content: blocks });

      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const name = tu.name as string;
        const input = tu.input ?? {};
        try {
          if (name.startsWith("propose_")) {
            const proposal: Proposal = {
              id: uid(),
              type: name,
              payload: input,
              summary: describeProposal(name, input),
            };
            proposals.push(proposal);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                queued: true,
                proposal_id: proposal.id,
                note: "Awaiting user confirmation in the UI. Do not assume it was applied.",
              }),
            });
          } else {
            const out = await execReadTool(name, input, context.supabase, businessId);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(out).slice(0, 12000),
            });
          }
        } catch (e: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: String(e?.message ?? e).slice(0, 500),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    await recordAiUsage(context.userId, MODEL, totalIn, totalOut, { actionType: "assistant" }).catch(() => undefined);

    return {
      text: finalText || "(no response)",
      proposals,
    };
  });

// =================================================================
// applyAction, performs an approved proposal (write) with user RLS
// =================================================================
export const applyAssistantAction = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        type: z.enum([
          "propose_create_task",
          "propose_complete_task",
          "propose_edit_task",
          "propose_create_note",
          "propose_create_event",
          "propose_move_event",
        ]),
        payload: z.record(z.string(), z.any()),
        businessId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireFeature } = await import("./entitlements.server");
    await requireFeature(supabase, userId, "ai_assistant");
    const p: any = data.payload;

    let resultId: string | null = null;

    switch (data.type) {
      case "propose_create_task": {
        let listId: string | undefined = p.list_id;
        if (!listId) {
          // Pick the first accessible list (RLS-scoped)
          const { data: lists } = await supabase
            .from("lists")
            .select("id, folders!inner(business_id)")
            .is("deleted_at", null)
            .limit(50);
          const candidate = (lists ?? []).find((l: any) =>
            data.businessId ? l.folders?.business_id === data.businessId : true,
          );
          if (!candidate) throw new Error("No accessible list to put this task in. Create a list first.");
          listId = candidate.id;
        }
        const { data: ins, error } = await supabase
          .from("tasks")
          .insert({
            list_id: listId!,
            business_id: data.businessId ?? null,
            title: String(p.title),
            description: p.description ?? null,
            priority: p.priority ?? "normal",
            due_at: p.due_at ?? null,
            status: "todo",
            position: 0,
            owner_id: userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        resultId = ins?.id ?? null;
        break;
      }
      case "propose_complete_task": {
        const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", p.task_id);
        if (error) throw error;
        resultId = p.task_id;
        break;
      }
      case "propose_edit_task": {
        const patch: any = {};
        if (p.title !== undefined) patch.title = p.title;
        if (p.due_at !== undefined) patch.due_at = p.due_at;
        if (p.priority !== undefined) patch.priority = p.priority;
        const { error } = await supabase.from("tasks").update(patch).eq("id", p.task_id);
        if (error) throw error;
        resultId = p.task_id;
        break;
      }
      case "propose_create_note": {
        const { data: ins, error } = await supabase
          .from("notes")
          .insert({
            title: String(p.title),
            body: p.body ?? "",
            folder_id: p.folder_id ?? null,
            business_id: data.businessId ?? null,
            owner_id: userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        resultId = ins?.id ?? null;
        break;
      }
      case "propose_create_event": {
        let calId: string | undefined = p.calendar_id;
        if (!calId) {
          const { data: cals } = await supabase.from("calendars").select("id, business_id").limit(20);
          const cand = (cals ?? []).find((c: any) =>
            data.businessId ? c.business_id === data.businessId : true,
          );
          if (!cand) throw new Error("No accessible calendar. Create a calendar first.");
          calId = cand.id;
        }
        const { data: ins, error } = await supabase
          .from("events")
          .insert({
            calendar_id: calId!,
            business_id: data.businessId ?? null,
            title: String(p.title),
            start_at: p.start_at,
            end_at: p.end_at,
            owner_id: userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        resultId = ins?.id ?? null;
        break;
      }
      case "propose_move_event": {
        const patch: any = { start_at: p.start_at };
        if (p.end_at) patch.end_at = p.end_at;
        const { error } = await supabase.from("events").update(patch).eq("id", p.event_id);
        if (error) throw error;
        resultId = p.event_id;
        break;
      }
    }

    // Log via service role (server-side); user-readable via RLS
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("assistant_actions").insert({
      user_id: userId,
      business_id: data.businessId ?? null,
      action_type: data.type,
      payload: data.payload as any,
      result_id: resultId,
      status: "applied",
    });

    return { ok: true, resultId };
  });
