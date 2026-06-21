import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRACE_DAYS = 14;

/**
 * Soft-delete the signed-in user's account. Sets deletion_requested_at + a
 * 14-day deletion_scheduled_at. The existing requireActiveUser middleware
 * blocks all server-fn access once deletion_scheduled_at is in the past;
 * a background job (admin pipeline) performs the final hard delete.
 *
 * Safeguards:
 *   - Blocks if the user owns a business/team that has OTHER active members
 *     (must transfer ownership or delete the team first).
 *   - Best-effort cancel of any active Paddle subscriptions.
 *   - Audits the request to analytics_events.
 */
export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        confirm: z.string().min(1, "Confirmation required"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Lookup the user's email so the user can confirm by typing it OR "DELETE".
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = user?.email ?? "";
    const confirm = data.confirm.trim();
    const matchesEmail = email && confirm.toLowerCase() === email.toLowerCase();
    if (confirm !== "DELETE" && !matchesEmail) {
      throw new Error('Please type your email or "DELETE" to confirm.');
    }

    // --- Team-ownership guard ----------------------------------------------
    // Find businesses the user owns that still have OTHER active members.
    const { data: ownedBiz } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("owner_id", userId);
    const orphanRisks: { id: string; name: string }[] = [];
    for (const b of ownedBiz ?? []) {
      const { count } = await supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("business_id", b.id)
        .eq("status", "active")
        .neq("user_id", userId);
      if ((count ?? 0) > 0) orphanRisks.push(b);
    }
    if (orphanRisks.length > 0) {
      throw new Error(
        `Transfer ownership or delete these team accounts first: ${orphanRisks
          .map((b) => b.name)
          .join(", ")}`,
      );
    }

    // --- Cancel any active Paddle subscriptions (best-effort) --------------
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("id, paddle_subscription_id, environment, status")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"]);
    if (subs && subs.length > 0) {
      try {
        const { getPaddleClient } = await import("@/lib/paddle.server");
        for (const s of subs) {
          if (!s.paddle_subscription_id) continue;
          try {
            const paddle = getPaddleClient(
              (s.environment as "sandbox" | "live") ?? "live",
            );
            await paddle.subscriptions.cancel(s.paddle_subscription_id, {
              effectiveFrom: "next_billing_period",
            });
          } catch (e) {
            console.warn("[privacy] paddle cancel failed", e);
          }
        }
      } catch (e) {
        // Paddle SDK or env keys not available — skip silently; admin sweep
        // will catch any orphaned billing on final erasure.
        console.warn("[privacy] paddle SDK unavailable", e);
      }
    }

    // --- Schedule soft delete ----------------------------------------------
    const now = new Date();
    const scheduled = new Date(now.getTime() + GRACE_DAYS * 86_400_000);
    const { error: uErr } = await supabase
      .from("profiles")
      .update({
        deletion_requested_at: now.toISOString(),
        deletion_requested_by: userId,
        deletion_scheduled_at: scheduled.toISOString(),
      })
      .eq("id", userId);
    if (uErr) throw new Error(uErr.message);

    // Audit
    await supabase.from("analytics_events").insert({
      user_id: userId,
      event_type: "account_deletion_requested",
      metadata: {
        grace_days: GRACE_DAYS,
        scheduled_for: scheduled.toISOString(),
        cancelled_subscriptions: subs?.length ?? 0,
      },
    });

    return {
      ok: true,
      scheduled_for: scheduled.toISOString(),
      grace_days: GRACE_DAYS,
    };
  });

/** Undo a pending account deletion request (within the 14-day window). */
export const cancelAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        deletion_requested_at: null,
        deletion_requested_by: null,
        deletion_scheduled_at: null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);

    await supabase.from("analytics_events").insert({
      user_id: userId,
      event_type: "account_deletion_cancelled",
      metadata: {},
    });
    return { ok: true };
  });

/** Current deletion status for the signed-in user. */
export const getDeletionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("profiles")
      .select("deletion_requested_at, deletion_scheduled_at")
      .eq("id", userId)
      .maybeSingle();
    return {
      requested_at: data?.deletion_requested_at ?? null,
      scheduled_at: data?.deletion_scheduled_at ?? null,
    };
  });

/**
 * Return rows in admin_access_log targeting the signed-in user.
 * RLS already restricts SELECT to target_user_id = auth.uid().
 */
export const listMyAdminAccessLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("admin_access_log")
      .select("id, admin_id, reason, mode, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);

    // Best-effort: hydrate admin names (RLS on profiles allows reading any
    // basic profile in this app; skip silently if not).
    const ids = Array.from(new Set((data ?? []).map((r) => r.admin_id)));
    let nameById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      nameById = new Map(
        (profs ?? []).map((p: { id: string; full_name: string | null }) => [
          p.id,
          p.full_name ?? "Support",
        ]),
      );
    }
    return (data ?? []).map((r) => ({
      ...r,
      admin_name: nameById.get(r.admin_id) ?? "Support",
    }));
  });
