import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-user UI preferences for ephemeral chrome state: which panels are
 * collapsed, which sidebars are pinned, etc. Backed by `profiles.ui_prefs`
 * (jsonb) — RLS already scopes profile reads/writes to `auth.uid()`, so the
 * preference is private to the user.
 *
 * The hook reads localStorage first for instant paint, then reconciles with
 * the DB once on mount, and debounces writes so toggling a panel doesn't
 * spam the network.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const LS_PREFIX = "hb.ui.";

function lsKey(userId: string | null, key: string) {
  return `${LS_PREFIX}${userId ?? "anon"}.${key}`;
}

async function loadAll(userId: string): Promise<Record<string, Json>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("ui_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data?.ui_prefs as Record<string, Json> | null) ?? {}) as Record<string, Json>;
}

async function saveOne(userId: string, key: string, value: Json) {
  // Read-modify-write keeps unrelated keys intact without needing a SQL fn.
  const current = await loadAll(userId);
  const next = { ...current, [key]: value };
  const { error } = await supabase
    .from("profiles")
    .update({ ui_prefs: next })
    .eq("id", userId);
  if (error) throw error;
}

export function useUiPref<T extends Json>(
  key: string,
  fallback: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [userId, setUserId] = useState<string | null>(null);
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(lsKey(null, key));
      if (raw != null) return JSON.parse(raw) as T;
    } catch {/* ignore */}
    return fallback;
  });
  const hydrated = useRef(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve user + hydrate from DB once.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      setUserId(data.user.id);
      // Promote anon-cached value into the user-scoped slot for next paint.
      try {
        const anonRaw = window.localStorage.getItem(lsKey(null, key));
        const userRaw = window.localStorage.getItem(lsKey(data.user.id, key));
        if (userRaw != null) {
          setValue(JSON.parse(userRaw) as T);
        } else if (anonRaw != null) {
          window.localStorage.setItem(lsKey(data.user.id, key), anonRaw);
        }
      } catch {/* ignore */}
      loadAll(data.user.id)
        .then((all) => {
          if (cancelled) return;
          if (Object.prototype.hasOwnProperty.call(all, key)) {
            const v = all[key] as T;
            setValue(v);
            try {
              window.localStorage.setItem(lsKey(data.user!.id, key), JSON.stringify(v));
            } catch {/* ignore */}
          }
          hydrated.current = true;
        })
        .catch(() => { hydrated.current = true; });
    });
    return () => { cancelled = true; };
  }, [key]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        window.localStorage.setItem(lsKey(userId, key), JSON.stringify(resolved));
      } catch {/* ignore */}
      if (userId && hydrated.current) {
        if (writeTimer.current) clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(() => {
          void saveOne(userId, key, resolved).catch(() => {/* swallow */});
        }, 300);
      }
      return resolved;
    });
  }, [userId, key]);

  return [value, update];
}
