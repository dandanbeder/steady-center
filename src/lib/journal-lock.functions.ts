import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Optional Journal lock. Users may protect the Journal behind a PIN/passphrase.
 * The PIN is hashed with PBKDF2-SHA256 (200k iterations) and stored as
 * `salt$iter$hash`. Verification happens server-side; the plaintext never
 * leaves the request.
 *
 * Writes go through the privileged admin client because a profile trigger
 * blocks direct client updates to the lock fields.
 */

const ITER = 200_000;
const KEY_LEN = 32;

async function hashPin(pin: string): Promise<string> {
  const { randomBytes, pbkdf2Sync } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, ITER, KEY_LEN, "sha256").toString("hex");
  return `${salt}$${ITER}$${hash}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const { pbkdf2Sync, timingSafeEqual } = await import("node:crypto");
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [salt, iterStr, expected] = parts;
  const iter = Number(iterStr) || ITER;
  const test = pbkdf2Sync(pin, salt, iter, KEY_LEN, "sha256").toString("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(test, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const getJournalLockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("journal_lock_enabled, journal_lock_updated_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { journal_lock_enabled?: boolean; journal_lock_updated_at?: string | null } | null;
    return {
      enabled: Boolean(row?.journal_lock_enabled),
      updatedAt: row?.journal_lock_updated_at ?? null,
    };
  });

export const setJournalLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ pin: z.string().min(4).max(128), currentPin: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("journal_lock_enabled, journal_lock_hash")
      .eq("id", context.userId)
      .maybeSingle();
    const r = row as { journal_lock_enabled?: boolean; journal_lock_hash?: string | null } | null;
    if (r?.journal_lock_enabled && r.journal_lock_hash) {
      if (!data.currentPin) throw new Error("Current PIN required");
      const ok = await verifyPin(data.currentPin, r.journal_lock_hash);
      if (!ok) throw new Error("Current PIN is incorrect");
    }
    const hash = await hashPin(data.pin);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        journal_lock_enabled: true,
        journal_lock_hash: hash,
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
    const ok = await verifyPin(data.pin, r.journal_lock_hash);
    return { ok };
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
      const ok = await verifyPin(data.pin, r.journal_lock_hash);
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
