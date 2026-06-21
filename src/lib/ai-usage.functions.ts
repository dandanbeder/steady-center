/**
 * User-facing AI usage history. Metadata only — never the prompt or content.
 *
 * Reads from `ai_usage_events` which is super-admin-only at the RLS layer.
 * This server function uses the admin client behind `requireSupabaseAuth`
 * and filters to the caller's BILLING ACCOUNT (pooled at the team owner if
 * the user is on a team), so pool members can see what their team is
 * spending without breaking the no-direct-user-read invariant on the raw
 * table.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().datetime().nullish(), // created_at of the last seen row
  })
  .strict()
  .partial();

export const getMyAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const limit = data.limit ?? 50;
    const cursor = data.cursor ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pool membership: usage for the whole billing account, not just this user.
    const { data: billing } = await supabaseAdmin.rpc("resolve_billing_account", {
      _user: userId,
    });
    const billingAccount = (billing as string | null) ?? userId;

    // For team accounts, gather all member ids so we can show every member's
    // usage to anyone in the pool. For solo accounts this is just [userId].
    const memberIds = new Set<string>([billingAccount]);
    // Find businesses the billing account owns, then all active members.
    const { data: ownedBusinesses } = await supabaseAdmin
      .from("memberships")
      .select("business_id")
      .eq("user_id", billingAccount)
      .eq("role", "owner")
      .eq("status", "active");
    const bizIds = ((ownedBusinesses ?? []) as Array<{ business_id: string }>).map(
      (b) => b.business_id,
    );
    if (bizIds.length > 0) {
      const { data: siblings } = await supabaseAdmin
        .from("memberships")
        .select("user_id")
        .in("business_id", bizIds)
        .eq("status", "active");
      for (const m of (siblings ?? []) as Array<{ user_id: string | null }>) {
        if (m.user_id) memberIds.add(m.user_id);
      }
    }

    let q = supabaseAdmin
      .from("ai_usage_events")
      .select(
        "id, user_id, action_type, model_used, tokens_in, tokens_out, audio_seconds, credits_charged, created_at",
      )
      .in("user_id", Array.from(memberIds))
      .order("created_at", { ascending: false })
      .limit(limit + 1); // ask for one extra to compute hasMore
    if (cursor) q = q.lt("created_at", cursor);

    const { data: rows, error } = await q;
    if (error) throw error;

    const list = (rows ?? []) as Array<{
      id: string;
      user_id: string;
      action_type: string;
      model_used: string;
      tokens_in: number;
      tokens_out: number;
      audio_seconds: number;
      credits_charged: number;
      created_at: string;
    }>;
    const hasMore = list.length > limit;
    const items = hasMore ? list.slice(0, limit) : list;

    // 30-day rolling totals for the at-a-glance summary at the top.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: totals } = await supabaseAdmin
      .from("ai_usage_events")
      .select("credits_charged, action_type")
      .in("user_id", Array.from(memberIds))
      .gte("created_at", since);

    const totals30d = {
      events: (totals ?? []).length,
      credits: ((totals ?? []) as Array<{ credits_charged: number }>).reduce(
        (a, r) => a + (r.credits_charged ?? 0),
        0,
      ),
    };

    return {
      pooled: billingAccount !== userId,
      items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
      totals30d,
    };
  });
