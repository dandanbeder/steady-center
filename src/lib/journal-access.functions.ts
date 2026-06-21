import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Consent-based super admin access to a user's private Journal.
 * - request: only platform admins, never themselves
 * - respond: only the target user
 * - revoke: target any time; admin only their own still-pending request
 * - logAccess: admin records each actual view/edit; trigger notifies user
 */

export const requestJournalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      reason: z.string().min(3).max(1000),
      mode: z.enum(["read", "write"]).default("read"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin) throw new Error("Forbidden");
    if (data.targetUserId === context.userId) throw new Error("Cannot request access to your own Journal");

    const { data: row, error } = await context.supabase
      .from("journal_access_grants")
      .insert({
        admin_id: context.userId,
        target_user_id: data.targetUserId,
        reason: data.reason,
        mode: data.mode,
      } as never)
      .select("id, status, requested_at, expires_at, mode")
      .single();
    if (error) throw error;
    return row;
  });

export const respondToJournalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      grantId: z.string().uuid(),
      decision: z.enum(["accepted", "declined"]),
      hours: z.number().int().min(1).max(168).default(24),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { status: data.decision };
    if (data.decision === "accepted") {
      patch.expires_at = new Date(Date.now() + data.hours * 3600 * 1000).toISOString();
    }
    const { data: row, error } = await context.supabase
      .from("journal_access_grants")
      .update(patch as never)
      .eq("id", data.grantId)
      .eq("target_user_id", context.userId)
      .select("id, status, expires_at")
      .single();
    if (error) throw error;
    return row;
  });

export const revokeJournalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ grantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("journal_access_grants")
      .update({ status: "revoked" } as never)
      .eq("id", data.grantId);
    if (error) throw error;
    return { ok: true };
  });

export const listMyJournalGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("journal_access_grants")
      .select("id, admin_id, target_user_id, reason, mode, status, requested_at, responded_at, expires_at, revoked_at")
      .or(`target_user_id.eq.${context.userId},admin_id.eq.${context.userId}`)
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const adminIds = Array.from(new Set((data ?? []).map((g) => g.admin_id)));
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", adminIds.length ? adminIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameById = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameById.set(p.id, p.full_name ?? "Super admin");
    }
    return (data ?? []).map((g) => ({ ...g, admin_name: nameById.get(g.admin_id) ?? "Super admin" }));
  });

export const listMyJournalAccessLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("journal_access_log")
      .select("id, grant_id, admin_id, note_id, action, accessed_at")
      .eq("target_user_id", context.userId)
      .order("accessed_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const adminIds = Array.from(new Set((data ?? []).map((r) => r.admin_id)));
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", adminIds.length ? adminIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameById = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameById.set(p.id, p.full_name ?? "Super admin");
    }
    return (data ?? []).map((r) => ({ ...r, admin_name: nameById.get(r.admin_id) ?? "Super admin" }));
  });

export const adminListJournalForTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin) throw new Error("Forbidden");

    // RLS on notes enforces the grant requirement; if no active grant the rows simply won't be visible.
    const { data: notes, error } = await context.supabase
      .from("notes")
      .select("id, title, body, created_at, updated_at")
      .eq("owner_id", data.targetUserId)
      .eq("note_type", "journal")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // Best-effort: log a "list" access against the active grant if one exists.
    const { data: grant } = await context.supabase
      .from("journal_access_grants")
      .select("id")
      .eq("admin_id", context.userId)
      .eq("target_user_id", data.targetUserId)
      .eq("status", "accepted")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (grant && (notes?.length ?? 0) > 0) {
      await context.supabase.from("journal_access_log").insert({
        grant_id: (grant as { id: string }).id,
        admin_id: context.userId,
        target_user_id: data.targetUserId,
        action: "list",
      } as never);
    }
    return { notes: notes ?? [], grantId: (grant as { id: string } | null)?.id ?? null };
  });

export const adminLogJournalView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      grantId: z.string().uuid(),
      targetUserId: z.string().uuid(),
      noteId: z.string().uuid(),
      action: z.enum(["view", "edit"]).default("view"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("journal_access_log").insert({
      grant_id: data.grantId,
      admin_id: context.userId,
      target_user_id: data.targetUserId,
      note_id: data.noteId,
      action: data.action,
    } as never);
    if (error) throw error;
    return { ok: true };
  });
