import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Optional Journal lock. Users may protect the Journal behind a PIN/passphrase
 * that's stored as a bcrypt hash via pgcrypto and verified server-side.
 *
 * Writes go through the privileged admin client because a profile trigger
 * blocks direct client updates to the lock fields. Reads of `enabled` are
 * fine through normal RLS.
 */

export const getJournalLockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("journal_lock_enabled, journal_lock_updated_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return {
      enabled: Boolean((data as { journal_lock_enabled?: boolean } | null)?.journal_lock_enabled),
      updatedAt: (data as { journal_lock_updated_at?: string | null } | null)?.journal_lock_updated_at ?? null,
    };
  });

export const setJournalLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ pin: z.string().min(4).max(128), currentPin: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // If a lock already exists, require the current PIN to rotate.
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("journal_lock_enabled, journal_lock_hash")
      .eq("id", context.userId)
      .maybeSingle();
    const r = row as { journal_lock_enabled?: boolean; journal_lock_hash?: string | null } | null;
    if (r?.journal_lock_enabled && r.journal_lock_hash) {
      if (!data.currentPin) throw new Error("Current PIN required");
      const { data: ok } = await supabaseAdmin.rpc("crypt_verify", {
        plain: data.currentPin,
        hash: r.journal_lock_hash,
      });
      if (!ok) throw new Error("Current PIN is incorrect");
    }
    const { data: hash, error: hErr } = await supabaseAdmin.rpc("crypt_hash", {
      plain: data.pin,
    });
    if (hErr) throw hErr;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        journal_lock_enabled: true,
        journal_lock_hash: hash as unknown as string,
        journal_lock_updated_at: new Date().toISOString(),
      } as never)
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const verifyJournalLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ pin: z.string().min(1).max(128) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("journal_lock_hash, journal_lock_enabled")
      .eq("id", context.userId)
      .maybeSingle();
    const r = row as { journal_lock_hash?: string | null; journal_lock_enabled?: boolean } | null;
    if (!r?.journal_lock_enabled || !r.journal_lock_hash) return { ok: true };
    const { data: ok, error } = await supabaseAdmin.rpc("crypt_verify", {
      plain: data.pin,
      hash: r.journal_lock_hash,
    });
    if (error) throw error;
    return { ok: Boolean(ok) };
  });

export const disableJournalLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ pin: z.string().min(1).max(128) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("journal_lock_hash, journal_lock_enabled")
      .eq("id", context.userId)
      .maybeSingle();
    const r = row as { journal_lock_hash?: string | null; journal_lock_enabled?: boolean } | null;
    if (r?.journal_lock_enabled && r.journal_lock_hash) {
      const { data: ok } = await supabaseAdmin.rpc("crypt_verify", {
        plain: data.pin,
        hash: r.journal_lock_hash,
      });
      if (!ok) throw new Error("PIN is incorrect");
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        journal_lock_enabled: false,
        journal_lock_hash: null,
        journal_lock_updated_at: new Date().toISOString(),
      } as never)
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
