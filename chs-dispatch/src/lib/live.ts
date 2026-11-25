import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

const CHANGED = "chs:changed";
/** Tell every live view on this page to refresh now (after a local write). */
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

/**
 * Runs `fetcher`, then re-runs it whenever any of `tables` change (Supabase Realtime,
 * filtered by RLS). Simple and robust: the database stays the single source of truth.
 */
export function useLive<T>(key: string, tables: string[], fetcher: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fetchRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const ch = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);
    for (const t of tables) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(reload, 150);
      });
    }
    ch.subscribe();
    const onLocal = () => reload();
    window.addEventListener(CHANGED, onLocal);
    // Safety net if a realtime message is missed.
    const poll = setInterval(reload, 15000);
    return () => {
      clearInterval(poll);
      window.removeEventListener(CHANGED, onLocal);
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  return { data, error, loading, reload };
}

/** Re-render every `ms` so countdowns and overdue checks stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}
