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

async function logAudit(
  adminId: string,
  targetUserId: string | null,
  action: string,
  before: unknown,
  after: unknown,
  reason: string | null,
) {
  try {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: adminId,
      target_user_id: targetUserId,
      action,
      before: (before ?? null) as never,
      after: (after ?? null) as never,
      reason: reason ?? null,
    });
  } catch (e) {
    console.error("[audit] failed", action, e);
  }
}

export type BillingAccountRow = {
  user_id: string;
  email: string;
  full_name: string;
  plan: "free" | "pro" | "team" | "other";
  product_id: string | null;
  status: "free" | "trialing" | "active" | "past_due" | "canceled" | string;
  environment: string | null;
  seats: number;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  cancel_at_period_end: boolean;
  businesses_count: number;
  calendar_connections_count: number;
  credit_balance: number;
  purchased_credits: number;
  overrides_count: number;
  trial_expires_soon: boolean;
  created_at: string;
};

function planOf(product_id: string | null | undefined): BillingAccountRow["plan"] {
  if (product_id === "team_plan") return "team";
  if (product_id === "pro_plan") return "pro";
  if (!product_id) return "free";
  return "other";
}

/** List every account with billing + usage rollup. Super-admin only. */
export const adminListBillingAccounts = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);
    const ids = authData.users.map((u) => u.id);
    if (ids.length === 0) return [] as BillingAccountRow[];

    const [
      { data: profiles },
      { data: subs },
      { data: usage },
      { data: credits },
      { data: overrides },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ids),
      supabaseAdmin
        .from("subscriptions")
        .select(
          "user_id, status, product_id, environment, current_period_start, current_period_end, trial_end, past_due_since, cancel_at_period_end, quantity, created_at",
        )
        .in("user_id", ids)
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("account_usage").select("user_id, businesses_count, calendar_connections_count").in("user_id", ids),
      supabaseAdmin.from("account_credits").select("account_user_id, credit_balance, purchased_credits").in("account_user_id", ids),
      supabaseAdmin.from("user_entitlement_overrides").select("user_id").in("user_id", ids),
    ]);

    const pmap = new Map(profiles?.map((p) => [p.id, p.full_name ?? ""]) ?? []);
    const subMap = new Map<string, NonNullable<typeof subs>[number]>();
    for (const s of subs ?? []) if (!subMap.has(s.user_id)) subMap.set(s.user_id, s);
    const usageMap = new Map(usage?.map((u) => [u.user_id, u]) ?? []);
    const creditMap = new Map(credits?.map((c) => [c.account_user_id, c]) ?? []);
    const overrideCounts = new Map<string, number>();
    for (const o of overrides ?? []) overrideCounts.set(o.user_id, (overrideCounts.get(o.user_id) ?? 0) + 1);

    const now = Date.now();
    return authData.users.map<BillingAccountRow>((u) => {
      const s = subMap.get(u.id);
      const usage = usageMap.get(u.id);
      const credit = creditMap.get(u.id);
      const trialEnd = s?.trial_end ? new Date(s.trial_end as string).getTime() : null;
      return {
        user_id: u.id,
        email: u.email ?? "",
        full_name: pmap.get(u.id) ?? "",
        plan: s ? planOf(s.product_id as string) : "free",
        product_id: (s?.product_id as string) ?? null,
        status: s?.status ?? "free",
        environment: (s?.environment as string) ?? null,
        seats: (s?.quantity as number) ?? 0,
        trial_end: (s?.trial_end as string) ?? null,
        current_period_start: (s?.current_period_start as string) ?? null,
        current_period_end: (s?.current_period_end as string) ?? null,
        past_due_since: (s?.past_due_since as string) ?? null,
        cancel_at_period_end: !!s?.cancel_at_period_end,
        businesses_count: usage?.businesses_count ?? 0,
        calendar_connections_count: usage?.calendar_connections_count ?? 0,
        credit_balance: credit?.credit_balance ?? 0,
        purchased_credits: credit?.purchased_credits ?? 0,
        overrides_count: overrideCounts.get(u.id) ?? 0,
        trial_expires_soon:
          s?.status === "trialing" && trialEnd !== null && trialEnd - now < 1000 * 60 * 60 * 24 * 3,
        created_at: u.created_at,
      };
    });
  });

/** Manual credit grant (top-up). Audited. */
export const adminGrantCredits = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      credits: z.number().int().min(1).max(1_000_000),
      months: z.number().int().min(1).max(120).default(12),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const tx = `manual_${context.userId.slice(0, 8)}_${Date.now()}`;
    const { error } = await supabaseAdmin.rpc("add_purchased_credits", {
      _user: data.user_id,
      _credits: data.credits,
      _months: data.months,
      _paddle_tx: tx,
    });
    if (error) throw new Error(error.message);
    await logAudit(
      context.userId,
      data.user_id,
      "credits.grant",
      null,
      { credits: data.credits, months: data.months, tx },
      data.reason,
    );
    return { ok: true };
  });
