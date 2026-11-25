import { createClient } from "@supabase/supabase-js";
import { demoFetch } from "@/demo/backend";

/** Demo build: an in-browser backend stands in for Supabase so the system can be reviewed anywhere. */
export const isDemo = import.meta.env.MODE === "demo";

const url = isDemo ? "https://demo.chs.invalid" : (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = isDemo ? "demo-anon-key" : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const isConfigured = !!url && !!key;

/** In the demo each tab keeps its own sign-in, so one tab can be the dispatcher and another a responder. */
function tabStorage() {
  try {
    sessionStorage.setItem("chs-probe", "1");
    sessionStorage.removeItem("chs-probe");
    return sessionStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  }
}

/** Per-tab auth key: supabase-js syncs sign-ins across tabs that share a key. */
function tabKey() {
  try {
    let k = sessionStorage.getItem("chs-demo-tab");
    if (!k) {
      k = `chs-demo-auth-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("chs-demo-tab", k);
    }
    return k;
  } catch {
    return `chs-demo-auth-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: !isDemo, ...(isDemo ? { storage: tabStorage(), storageKey: tabKey() } : {}) },
  ...(isDemo ? { global: { fetch: demoFetch } } : {}),
});
