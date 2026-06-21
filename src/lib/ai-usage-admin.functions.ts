/**
 * Super-admin reads for the per-event AI usage ledger.
 * Both functions are gated by `profiles.platform_role = 'superadmin'`
 * via the `is_platform_admin()` SQL function.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ListInput = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  actionType: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
});

async function assertSuperadmin(supabase: { rpc: (n: string) => Promise<{ data: unknown }> }) {
  const { data } = await supabase.rpc("is_platform_admin");
  if (!data) throw new Error("Forbidden");
}

export const listAiUsageEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperadmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("ai_usage_events")
      .select(
        "id, user_id, team_id, action_type, model_used, tokens_in, tokens_out, audio_seconds, true_cost_micros, credits_charged, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (data.actionType) q = q.eq("action_type", data.actionType);
    if (data.cursor) q = q.lt("created_at", data.cursor);

    const { data: rows, error } = await q;
    if (error) throw error;
    const nextCursor = rows && rows.length === data.limit ? rows[rows.length - 1].created_at : null;
    return { rows: rows ?? [], nextCursor };
  });

const RollupInput = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupBy: z.enum(["user", "action_type", "model"]).default("action_type"),
});

type Row = {
  user_id: string;
  action_type: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
  audio_seconds: number;
  true_cost_micros: number;
  credits_charged: number;
};

export const aiUsageRollup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RollupInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperadmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("ai_usage_events")
      .select(
        "user_id, action_type, model_used, tokens_in, tokens_out, audio_seconds, true_cost_micros, credits_charged",
      )
      .limit(50_000);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);

    const { data: rows, error } = await q;
    if (error) throw error;

    const keyOf = (r: Row) =>
      data.groupBy === "user" ? r.user_id : data.groupBy === "model" ? r.model_used : r.action_type;

    const agg = new Map<
      string,
      {
        key: string;
        actions: number;
        tokens_in: number;
        tokens_out: number;
        audio_seconds: number;
        true_cost_micros: number;
        credits_charged: number;
      }
    >();
    for (const r of (rows ?? []) as Row[]) {
      const k = keyOf(r);
      const cur =
        agg.get(k) ??
        {
          key: k,
          actions: 0,
          tokens_in: 0,
          tokens_out: 0,
          audio_seconds: 0,
          true_cost_micros: 0,
          credits_charged: 0,
        };
      cur.actions += 1;
      cur.tokens_in += r.tokens_in ?? 0;
      cur.tokens_out += r.tokens_out ?? 0;
      cur.audio_seconds += r.audio_seconds ?? 0;
      cur.true_cost_micros += Number(r.true_cost_micros ?? 0);
      cur.credits_charged += r.credits_charged ?? 0;
      agg.set(k, cur);
    }
    const out = [...agg.values()].sort((a, b) => b.true_cost_micros - a.true_cost_micros);
    return { groupBy: data.groupBy, rows: out };
  });
