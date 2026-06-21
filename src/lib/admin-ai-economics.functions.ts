/**
 * Super-admin "AI Economics" reads. All gated by is_platform_admin().
 * Compute exclusively from rollups + small per-row reads — no full scans
 * of ai_usage_events from the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

export type EconomicsSummary = {
  series_30d: Array<{
    day: string;
    cost_micros: number;
    credits_charged: number;
    events_count: number;
  }>;
  totals_30d: { cost_micros: number; credits_charged: number; events_count: number };
  totals_alltime: { cost_micros: number; credits_charged: number; events_count: number };
  revenue: {
    allowance_value_micros_per_month: number;
    topup_revenue_30d_cents: number;
    topup_revenue_alltime_cents: number;
    topup_purchases_30d: number;
    sell_per_credit_micros: number;
  };
  kitty: {
    funded_micros: number;
    consumed_micros: number;
    consumed_raw_micros: number;
    remaining_micros: number;
    daily_burn_micros: number;
    runway_days: number | null;
    first_funded_at: string | null;
    low_kitty_alert: boolean;
  };
  generated_at: string;
};

export type PerAccountRow = {
  account_user_id: string;
  email: string;
  full_name: string;
  allowance_credits: number;
  allowance_used: number;
  allowance_pct: number;
  purchased_credits: number;
  topup_paused: boolean;
  total_cost_micros: number;
  total_credits_charged: number;
  events_count: number;
  last_event_at: string | null;
  topup_revenue_cents: number;
  over_80: boolean;
  hard_stopped: boolean;
};

export type KittyEntry = {
  id: string;
  delta_micros: number;
  kind: "fund" | "adjust";
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** Platform-level summary (rollups + revenue + kitty status). */
export const adminAiEconomicsSummary = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_ai_economics_summary");
    if (error) throw new Error(error.message);
    return data as unknown as EconomicsSummary;
  });

/** Per-account economics (uses ai_usage_account_totals rollup). */
export const adminAiPerAccountEconomics = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_ai_per_account_economics");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PerAccountRow[];
  });

/** Recent kitty ledger entries. */
export const adminListKittyEntries = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("ai_kitty_ledger")
      .select("id, delta_micros, kind, note, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as KittyEntry[];
  });

/** Record a funded amount or adjustment. delta_cents may be negative for adjustments. */
export const adminRecordKittyEntry = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      delta_cents: z.number().int().refine((n) => n !== 0, "Amount must be non-zero"),
      kind: z.enum(["fund", "adjust"]),
      note: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const deltaMicros = data.delta_cents * 10_000; // cents → micros
    const { error } = await supabaseAdmin.rpc("admin_record_kitty_entry", {
      _delta_micros: deltaMicros,
      _kind: data.kind,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
