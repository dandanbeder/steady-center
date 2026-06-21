/**
 * Super-admin abuse controls.
 *
 * Hard rules baked in here:
 *   - Hitting the credit hard-stop is NOT abuse. The hard-stop already pauses
 *     AI and prompts a top-up. We never act here on credit-balance threshold
 *     alone, only on misuse signals (cap-hits, IP fan-out, abnormal burn,
 *     manual report).
 *   - Every action requires a reason, is audited, and is reversible (except
 *     terminate, which schedules deletion).
 *   - The protected primary super-admin is shielded from suspend / terminate
 *     / throttle / role-change.
 *   - All gates are server-enforced via requirePlatformAdmin().
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

async function assertNotProtectedPrimary(userId: string, action: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_protected_primary")
    .eq("id", userId)
    .maybeSingle();
  if ((data as { is_protected_primary?: boolean } | null)?.is_protected_primary) {
    throw new Error(`The primary super admin cannot be ${action}.`);
  }
}

// ============ Queue / scanning ============

export type AbuseFlagRow = {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  status: "open" | "dismissed" | "actioned";
  severity: "low" | "medium" | "high";
  source: "auto" | "manual";
  signals: Array<{ kind: string; observed: number; threshold: number; severity: string }>;
  evidence_summary: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  resolution_action: string | null;
  throttle_level: string;
  user_status: string;
};

export const adminListAbuseFlags = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((i: { status?: "open" | "dismissed" | "actioned" | "all" } | undefined) =>
    z.object({ status: z.enum(["open", "dismissed", "actioned", "all"]).default("open") }).parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<AbuseFlagRow[]> => {
    await requirePlatformAdmin(context.userId);
    let q = supabaseAdmin
      .from("abuse_flags")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    let profMap = new Map<string, { email: string | null; full_name: string | null; throttle_level: string; status: string }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name, throttle_level, status")
        .in("id", userIds);
      profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    }
    return (rows ?? []).map((r: any) => {
      const p = profMap.get(r.user_id);
      return {
        ...r,
        email: p?.email ?? null,
        full_name: p?.full_name ?? null,
        throttle_level: p?.throttle_level ?? "none",
        user_status: p?.status ?? "active",
      };
    }) as AbuseFlagRow[];
  });

/** Run the auto-flag scanner. Inserts/updates open flags, never punishes. */
export const adminScanAbuse = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_scan_abuse_signals");
    if (error) throw new Error(error.message);
    await logAudit(context.userId, null, "abuse.scan", null, { flagged: data?.length ?? 0 }, null);
    return { flagged: data?.length ?? 0 };
  });

export const adminManualFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      severity: z.enum(["low", "medium", "high"]),
      evidence_summary: z.string().min(5).max(1000),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    // Upgrade an existing open flag instead of creating duplicates.
    const { data: existing } = await supabaseAdmin
      .from("abuse_flags")
      .select("id")
      .eq("user_id", data.user_id)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("abuse_flags")
        .update({ severity: data.severity, evidence_summary: data.evidence_summary, source: "manual" })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("abuse_flags").insert({
        user_id: data.user_id,
        source: "manual",
        severity: data.severity,
        evidence_summary: data.evidence_summary,
        signals: [],
        created_by: context.userId,
      });
    }
    await logAudit(context.userId, data.user_id, "abuse.flag", null, { severity: data.severity }, data.reason);
    return { ok: true };
  });

export const adminResolveFlag = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      flag_id: z.string().uuid(),
      action: z.enum(["dismissed", "actioned"]),
      note: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("abuse_flags")
      .select("*")
      .eq("id", data.flag_id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("abuse_flags")
      .update({
        status: data.action,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        resolution_note: data.note,
      })
      .eq("id", data.flag_id);
    if (error) throw new Error(error.message);
    await logAudit(
      context.userId,
      (before as any)?.user_id ?? null,
      `abuse.flag.${data.action}`,
      before,
      { status: data.action },
      data.note,
    );
    return { ok: true };
  });

// ============ Enforcement steps ============

export const adminWarnUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      message: z.string().min(5).max(1000),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await assertNotProtectedPrimary(data.user_id, "warned");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        last_warned_at: new Date().toISOString(),
        last_warning_message: data.message,
        warned_by: context.userId,
      })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    // TODO: send email if email infra is wired; in-app banner reads last_warning_message.
    await logAudit(context.userId, data.user_id, "user.warn", null, { message: data.message }, data.reason);
    return { ok: true };
  });

export const adminThrottleUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      level: z.enum(["none", "tight"]),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await assertNotProtectedPrimary(data.user_id, "throttled");
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("throttle_level, throttle_reason")
      .eq("id", data.user_id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        throttle_level: data.level,
        throttle_reason: data.level === "none" ? null : data.reason,
        throttle_set_at: data.level === "none" ? null : new Date().toISOString(),
        throttle_set_by: data.level === "none" ? null : context.userId,
      })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await logAudit(
      context.userId,
      data.user_id,
      data.level === "none" ? "user.throttle.clear" : "user.throttle.set",
      before,
      { throttle_level: data.level },
      data.reason,
    );
    return { ok: true };
  });

/**
 * Terminate is the last resort. Schedules deletion via the existing
 * deletion_scheduled_at column (already used by the deletion pipeline)
 * and bans auth login immediately. The primary super-admin is shielded.
 */
export const adminTerminateUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      reason: z.string().min(10).max(1000),
      confirm_phrase: z.literal("TERMINATE"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("You cannot terminate your own account.");
    await assertNotProtectedPrimary(data.user_id, "terminated");
    const { data: tgt } = await supabaseAdmin
      .from("profiles")
      .select("platform_role, status")
      .eq("id", data.user_id)
      .maybeSingle();
    if ((tgt as any)?.platform_role === "superadmin") {
      throw new Error("Demote the user from super-admin before terminating.");
    }
    const now = new Date().toISOString();
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({
        status: "suspended",
        suspended_reason: `TERMINATED: ${data.reason}`,
        terminated_at: now,
        terminated_by: context.userId,
        terminated_reason: data.reason,
        deletion_scheduled_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        deletion_requested_by: context.userId,
      })
      .eq("id", data.user_id);
    if (pErr) throw new Error(pErr.message);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: "876000h",
    } as any);
    if (aErr) throw new Error(aErr.message);
    await logAudit(context.userId, data.user_id, "user.terminate", tgt, { status: "terminated" }, data.reason);
    return { ok: true };
  });

// ============ Thresholds config ============

export const adminGetAbuseThresholds = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("abuse_thresholds")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const adminSetAbuseThresholds = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({
      enabled: z.boolean(),
      cap_hits_24h_high: z.number().int().min(1).max(100000),
      cap_hits_24h_medium: z.number().int().min(1).max(100000),
      distinct_ips_7d_high: z.number().int().min(1).max(100),
      distinct_ips_7d_medium: z.number().int().min(1).max(100),
      credit_burn_24h_high: z.number().int().min(1).max(10_000_000),
      credit_burn_24h_medium: z.number().int().min(1).max(10_000_000),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: before } = await supabaseAdmin
      .from("abuse_thresholds")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    const { reason, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("abuse_thresholds")
      .update({ ...patch, updated_by: context.userId, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    await logAudit(context.userId, null, "abuse.thresholds.update", before, patch, reason);
    return { ok: true };
  });
