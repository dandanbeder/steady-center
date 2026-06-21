/**
 * Server-callable credit balance / threshold APIs. Read-only or RPC into
 * SECURITY DEFINER functions, clients never write balances directly.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCreditBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Use service-role to read the pooled balance: a non-owner team member
    // legitimately needs to see their team's account_credits row, which RLS
    // alone won't allow. resolve_billing_account is the only thing that
    // decides which account they're billed against.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: billing } = await supabaseAdmin.rpc("resolve_billing_account", {
      _user: userId,
    });
    const billingAccount = (billing as string | null) ?? userId;

    const { data } = await supabaseAdmin
      .from("account_credits")
      .select(
        "credit_balance, purchased_credits, allowance_credits, current_cycle_start, current_cycle_end, low_balance_threshold, low_balance_alerted_at, topup_paused",
      )
      .eq("account_user_id", billingAccount)
      .maybeSingle();

    const allowance = (data?.credit_balance as number | null) ?? 0;
    const purchased = (data?.purchased_credits as number | null) ?? 0;

    const { data: lots } = await supabaseAdmin
      .from("credit_lots")
      .select("id, credits_remaining, credits_initial, purchased_at, expires_at")
      .eq("account_user_id", billingAccount)
      .gt("credits_remaining", 0)
      .order("expires_at", { ascending: true });

    return {
      billingAccount,
      pooled: billingAccount !== userId,
      allowance,
      purchased,
      total: allowance + purchased,
      allowanceCap: (data?.allowance_credits as number | null) ?? 0,
      cycleStart: (data?.current_cycle_start as string | null) ?? null,
      cycleEnd: (data?.current_cycle_end as string | null) ?? null,
      lowThreshold: (data?.low_balance_threshold as number | null) ?? 20,
      lowAlertedAt: (data?.low_balance_alerted_at as string | null) ?? null,
      paused: (data?.topup_paused as boolean | null) ?? false,
      lots: (lots ?? []) as Array<{
        id: string;
        credits_remaining: number;
        credits_initial: number;
        purchased_at: string;
        expires_at: string;
      }>,
    };
  });

export const setLowBalanceThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ threshold: z.number().int().min(0).max(100_000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_low_balance_threshold", {
      _threshold: data.threshold,
    });
    if (error) throw error;
    return { ok: true };
  });
