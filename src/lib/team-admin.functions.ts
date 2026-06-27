import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";


const ALL_ROLES = ["owner", "admin", "member", "commenter", "viewer"] as const;
type Role = (typeof ALL_ROLES)[number];
const RANK: Record<Role, number> = {
  viewer: 1, commenter: 2, member: 3, admin: 4, owner: 5,
};

/** Resolve caller role in the business (with platform-admin escape hatch). */
async function callerRole(business_id: string, user_id: string): Promise<{ role: Role | null; isPlatformAdmin: boolean }> {
  const [{ data: mem }, { data: prof }] = await Promise.all([
    supabaseAdmin
      .from("memberships")
      .select("role")
      .eq("business_id", business_id)
      .eq("user_id", user_id)
      .eq("status", "active")
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("platform_role").eq("id", user_id).maybeSingle(),
  ]);
  return {
    role: ((mem?.role as Role | undefined) ?? null),
    isPlatformAdmin: prof?.platform_role === "superadmin",
  };
}

async function requireMin(business_id: string, user_id: string, min: "admin" | "owner") {
  const { role, isPlatformAdmin } = await callerRole(business_id, user_id);
  if (isPlatformAdmin) return role ?? "owner";
  const need = min === "owner" ? 5 : 4;
  if (!role || RANK[role] < need) throw new Error("Not authorized");
  return role;
}

/**
 * Append a row to team_audit_log. Service-role insert; SELECT RLS already
 * scopes reads to admin+ of the business.
 * Stash reason + resource hints inside `after` JSON so we don't need a
 * migration for the existing 4-column table.
 */
export async function auditTeamAction(opts: {
  business_id: string;
  actor_id: string;
  action: string;
  target_user_id?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
}) {
  try {
    const after =
      opts.reason || opts.resource_type || opts.resource_id || opts.after !== undefined
        ? {
            ...(typeof opts.after === "object" && opts.after ? (opts.after as Record<string, unknown>) : opts.after !== undefined ? { value: opts.after } : {}),
            ...(opts.reason ? { _reason: opts.reason } : {}),
            ...(opts.resource_type ? { _resource_type: opts.resource_type } : {}),
            ...(opts.resource_id ? { _resource_id: opts.resource_id } : {}),
          }
        : null;
    await supabaseAdmin.from("team_audit_log").insert({
      business_id: opts.business_id,
      actor_id: opts.actor_id,
      action: opts.action,
      target_user_id: opts.target_user_id ?? null,
      before: (opts.before ?? null) as never,
      after: after as never,
    });
  } catch (e) {
    console.error("[team_audit] insert failed", opts.action, e);
  }
}

export type TeamOverview = {
  business: { id: string; name: string };
  caller: { role: Role; isPlatformAdmin: boolean };
  members: {
    active: number;
    invited: number;
    byRole: Record<Role, number>;
  };
  seats: {
    /** roles that count toward paid seats */
    paidUsed: number;
    /** roles that are free collaborators */
    freeUsed: number;
    /** seat count purchased on the owner's subscription, or null if not visible */
    paidPurchased: number | null;
    productId: string | null;
    status: string | null;
    currentPeriodEnd: string | null;
  };
};

/** Owner / admin view: roster counts + seat / billing summary. No private content. */
export const getTeamOverview = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<TeamOverview> => {
    const { userId } = context;
    const role = await requireMin(data.business_id, userId, "admin");

    const [{ data: biz }, { data: prof }, { data: members }] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id, name, owner_id")
        .eq("id", data.business_id)
        .maybeSingle(),
      supabaseAdmin.from("profiles").select("platform_role").eq("id", userId).maybeSingle(),
      supabaseAdmin
        .from("memberships")
        .select("role, status")
        .eq("business_id", data.business_id),
    ]);
    if (!biz) throw new Error("Business not found");

    const byRole: Record<Role, number> = {
      owner: 0, admin: 0, member: 0, commenter: 0, viewer: 0,
    };
    let active = 0;
    let invited = 0;
    let paidUsed = 0;
    let freeUsed = 0;
    for (const m of members ?? []) {
      const r = (m.role as Role | undefined) ?? null;
      if (!r) continue;
      if (m.status === "active") {
        active += 1;
        byRole[r] += 1;
        if (r === "owner" || r === "admin" || r === "member") paidUsed += 1;
        else if (r === "viewer" || r === "commenter") freeUsed += 1;
      } else if (m.status === "invited") {
        invited += 1;
      }
    }

    // Seat purchase lives on the owner's subscription. Visible only to owners
    // of this business (or platform admins). Admins see seat usage but not
    // the owner's billing record.
    let paidPurchased: number | null = null;
    let productId: string | null = null;
    let status: string | null = null;
    let currentPeriodEnd: string | null = null;
    const isPlatformAdmin = prof?.platform_role === "superadmin";
    if (role === "owner" || isPlatformAdmin) {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("quantity, product_id, status, current_period_end")
        .eq("user_id", (biz as { owner_id: string }).owner_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sub) {
        productId = (sub.product_id as string | null) ?? null;
        status = (sub.status as string | null) ?? null;
        currentPeriodEnd = (sub.current_period_end as string | null) ?? null;
        paidPurchased =
          productId === "team_plan"
            ? Number(sub.quantity ?? 0)
            : productId === "pro_plan"
              ? 1
              : 0;
      }
    }

    return {
      business: { id: biz.id as string, name: (biz.name as string) ?? "" },
      caller: { role, isPlatformAdmin },
      members: { active, invited, byRole },
      seats: { paidUsed, freeUsed, paidPurchased, productId, status, currentPeriodEnd },
    };
  });

/** Owner only. Promote `new_owner_user_id` to owner; demote caller to admin. */
export const transferOwnership = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z
      .object({
        business_id: z.string().uuid(),
        new_owner_user_id: z.string().uuid(),
        reason: z.string().min(3).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireMin(data.business_id, userId, "owner");
    if (data.new_owner_user_id === userId) throw new Error("You are already the owner.");

    const { data: target } = await supabaseAdmin
      .from("memberships")
      .select("id, role, status")
      .eq("business_id", data.business_id)
      .eq("user_id", data.new_owner_user_id)
      .maybeSingle();
    if (!target || target.status !== "active") {
      throw new Error("New owner must be an active member of this team.");
    }

    const { data: myMembership } = await supabaseAdmin
      .from("memberships")
      .select("id, role")
      .eq("business_id", data.business_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!myMembership) throw new Error("Membership not found");

    const { error: e1 } = await supabaseAdmin
      .from("memberships")
      .update({ role: "owner" })
      .eq("id", target.id);
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await supabaseAdmin
      .from("memberships")
      .update({ role: "admin" })
      .eq("id", myMembership.id);
    if (e2) throw new Error(e2.message);

    // Update businesses.owner_id so ownership of the row itself moves.
    await supabaseAdmin
      .from("businesses")
      .update({ owner_id: data.new_owner_user_id })
      .eq("id", data.business_id);

    await auditTeamAction({
      business_id: data.business_id,
      actor_id: userId,
      action: "transfer_ownership",
      target_user_id: data.new_owner_user_id,
      before: { owner: userId },
      after: { owner: data.new_owner_user_id },
      reason: data.reason,
    });
    return { ok: true };
  });

export type TeamAuditEntry = {
  id: string;
  action: string;
  actor_id: string | null;
  target_user_id: string | null;
  actor_name: string | null;
  target_name: string | null;
  before: Json | null;
  after: Json | null;
  reason: string | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
};



/** Admin+ paginated audit log for a business. */
export const listTeamAuditLog = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z
      .object({
        business_id: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
        before: z.string().datetime().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TeamAuditEntry[]> => {
    const { userId } = context;
    await requireMin(data.business_id, userId, "admin");

    let q = supabaseAdmin
      .from("team_audit_log")
      .select("id, action, actor_id, target_user_id, before, after, created_at")
      .eq("business_id", data.business_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = Array.from(
      new Set(
        (rows ?? [])
          .flatMap((r) => [r.actor_id as string | null, r.target_user_id as string | null])
          .filter((x): x is string => !!x),
      ),
    );
    let nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      nameMap = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string) ?? ""]));
    }

    return (rows ?? []).map((r) => {
      const after = (r.after ?? null) as Record<string, unknown> | null;
      const reason = (after && typeof after._reason === "string" ? after._reason : null) as string | null;
      const resource_type = (after && typeof after._resource_type === "string" ? after._resource_type : null) as string | null;
      const resource_id = (after && typeof after._resource_id === "string" ? after._resource_id : null) as string | null;
      return {
        id: r.id as string,
        action: r.action as string,
        actor_id: (r.actor_id as string | null) ?? null,
        target_user_id: (r.target_user_id as string | null) ?? null,
        actor_name: r.actor_id ? nameMap.get(r.actor_id as string) ?? null : null,
        target_name: r.target_user_id ? nameMap.get(r.target_user_id as string) ?? null : null,
        before: r.before ?? null,
        after: r.after ?? null,
        reason,
        resource_type,
        resource_id,
        created_at: r.created_at as string,
      };
    });
  });

/**
 * Team AI kitty usage: pool totals + per-member consumption this cycle.
 *
 * Authorization: business admin+ (or platform admin). Caller business_id is
 * validated; we then resolve the owner's billing account (the kitty) and
 * read this-cycle credit_ledger rows scoped to that account.
 *
 * Privacy: the response contains ONLY credit metering, credits_used,
 * action counts, share-of-pool percent, display name and role. NO private
 * content (notes, tasks, mood, journal), NO cost/margin figures. The
 * kitty's allowance/balance is plan metadata (credits, not dollars), so
 * surfacing it to the team admin is safe.
 */
export const getTeamKittyUsage = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator(z.object({ business_id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    await requireMin(data.business_id, context.userId, "admin");

    // Owner of this business -> the kitty's account_user_id.
    const { data: ownerMem } = await supabaseAdmin
      .from("memberships")
      .select("user_id")
      .eq("business_id", data.business_id)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle();
    const ownerId = (ownerMem?.user_id as string | undefined) ?? null;
    if (!ownerId) throw new Error("No active owner for this team");

    // Pool stats.
    const { data: ac } = await supabaseAdmin
      .from("account_credits")
      .select("allowance_credits, credit_balance, purchased_credits, current_cycle_start, current_cycle_end, topup_paused")
      .eq("account_user_id", ownerId)
      .maybeSingle();

    const allowance = (ac?.allowance_credits as number | undefined) ?? 0;
    const balance = (ac?.credit_balance as number | undefined) ?? 0;
    const purchased = (ac?.purchased_credits as number | undefined) ?? 0;
    const cycleStart = (ac?.current_cycle_start as string | null) ?? null;
    const cycleEnd = (ac?.current_cycle_end as string | null) ?? null;
    const paused = (ac?.topup_paused as boolean | undefined) ?? false;
    const used = Math.max(0, allowance - balance);

    // Per-member usage this cycle, only debits (delta < 0) on the allowance/purchased sources.
    const since = cycleStart ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: ledger } = await supabaseAdmin
      .from("credit_ledger")
      .select("acting_user_id, delta, source")
      .eq("account_user_id", ownerId)
      .lt("delta", 0)
      .in("source", ["allowance", "purchased"])
      .gte("created_at", since);

    const perMember = new Map<string, { credits_used: number; actions: number }>();
    for (const row of ledger ?? []) {
      const uid = row.acting_user_id as string;
      const spent = Math.abs((row.delta as number) ?? 0);
      const cur = perMember.get(uid) ?? { credits_used: 0, actions: 0 };
      cur.credits_used += spent;
      cur.actions += 1;
      perMember.set(uid, cur);
    }

    // Active paid-seat members (anyone who could legitimately spend kitty credits).
    const { data: members } = await supabaseAdmin
      .from("memberships")
      .select("user_id, role")
      .eq("business_id", data.business_id)
      .eq("status", "active")
      .in("role", ["owner", "admin", "member"]);

    const memberIds = (members ?? []).map((m) => m.user_id as string);
    const ids = Array.from(new Set([...memberIds, ...perMember.keys()]));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string) ?? null]));
    const roleMap = new Map((members ?? []).map((m) => [m.user_id as string, m.role as string]));

    const paidSeats = memberIds.length || 1;
    const fairShare = used > 0 ? used / paidSeats : 0;

    const breakdown = ids.map((uid) => {
      const usage = perMember.get(uid) ?? { credits_used: 0, actions: 0 };
      const share_pct = used > 0 ? Math.round((usage.credits_used * 1000) / used) / 10 : 0;
      // Flag: this member alone consumed >= 2× their fair share AND > 10% of the pool.
      const flagged =
        fairShare > 0 &&
        usage.credits_used >= fairShare * 2 &&
        usage.credits_used >= used * 0.1;
      return {
        user_id: uid,
        display_name: nameMap.get(uid) ?? null,
        role: roleMap.get(uid) ?? "removed",
        credits_used: usage.credits_used,
        actions: usage.actions,
        share_pct,
        flagged,
      };
    }).sort((a, b) => b.credits_used - a.credits_used);

    return {
      pool: {
        allowance,
        balance,
        purchased,
        used,
        paused,
        hard_stopped: balance + purchased <= 0,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        paid_seats: paidSeats,
      },
      members: breakdown,
    };
  });

/**
 * What the signed-in member has personally consumed from their team's
 * shared kitty this cycle, plus the pool's headline numbers so they can
 * see how much is left. RLS on credit_ledger already permits self-reads
 * (acting_user_id = auth.uid()); this server fn aggregates them.
 */
export const getMyKittyUsage = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { data: billing } = await supabaseAdmin.rpc("resolve_billing_account", { _user: userId });
    const billingAccount = (billing as string | null) ?? userId;
    const isPooled = billingAccount !== userId;

    const { data: ac } = await supabaseAdmin
      .from("account_credits")
      .select("allowance_credits, credit_balance, purchased_credits, current_cycle_start, current_cycle_end, topup_paused")
      .eq("account_user_id", billingAccount)
      .maybeSingle();

    const allowance = (ac?.allowance_credits as number | undefined) ?? 0;
    const balance = (ac?.credit_balance as number | undefined) ?? 0;
    const purchased = (ac?.purchased_credits as number | undefined) ?? 0;
    const cycleStart = (ac?.current_cycle_start as string | null) ?? null;
    const since = cycleStart ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

    const { data: myRows } = await supabaseAdmin
      .from("credit_ledger")
      .select("delta, source")
      .eq("account_user_id", billingAccount)
      .eq("acting_user_id", userId)
      .lt("delta", 0)
      .in("source", ["allowance", "purchased"])
      .gte("created_at", since);

    let myCredits = 0;
    let myActions = 0;
    for (const r of myRows ?? []) {
      myCredits += Math.abs((r.delta as number) ?? 0);
      myActions += 1;
    }

    return {
      is_team_kitty: isPooled,
      pool: {
        allowance,
        balance,
        purchased,
        used: Math.max(0, allowance - balance),
        paused: (ac?.topup_paused as boolean | undefined) ?? false,
        cycle_end: (ac?.current_cycle_end as string | null) ?? null,
      },
      me: { credits_used: myCredits, actions: myActions },
    };
  });
