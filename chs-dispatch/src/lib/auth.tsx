import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile, Role } from "./db";

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: Role[];
  isControl: boolean;
  isResponder: boolean;
  isClinical: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  // Whose roles are loaded. Until it matches the session, route guards must wait.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setSessionChecked(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setProfile(null);
      setRoles([]);
      setLoadedFor(null);
      return;
    }
    (async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      if (cancelled) return;
      setProfile((p.data as Profile) ?? null);
      setRoles(((r.data ?? []) as { role: Role }[]).map((x) => x.role));
      setLoadedFor(uid);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loading = !sessionChecked || (!!uid && loadedFor !== uid);
  const has = (...rs: Role[]) => roles.some((r) => rs.includes(r));
  const value: AuthState = {
    loading,
    session,
    profile,
    roles,
    isControl: has("dispatcher", "dom", "admin"),
    isResponder: has("responder"),
    isClinical: has("clinical", "admin"),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
