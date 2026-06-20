import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const SUPPORT_SESSION_STATE_KEY = "heartbeat:support-session:state";
export const SUPPORT_SESSION_ADMIN_BACKUP_KEY = "heartbeat:support-session:admin-session";

export type SupportSessionStartResult = {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  mode: "read" | "write";
  started_at: string;
  ended_at: string | null;
  target_email: string;
  target_name: string;
  action_link: string;
};

export type LocalSupportSession = Omit<SupportSessionStartResult, "action_link">;

export function getLocalSupportSession(): LocalSupportSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUPPORT_SESSION_STATE_KEY);
    return raw ? (JSON.parse(raw) as LocalSupportSession) : null;
  } catch {
    return null;
  }
}

export async function beginSupportSession(session: SupportSessionStartResult) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("No admin session to restore later");
  window.localStorage.setItem(SUPPORT_SESSION_ADMIN_BACKUP_KEY, JSON.stringify(data.session));
  window.localStorage.setItem(SUPPORT_SESSION_STATE_KEY, JSON.stringify(stripActionLink(session)));
  window.location.assign(session.action_link);
}

export async function restoreAdminSession(): Promise<Session | null> {
  const raw = window.localStorage.getItem(SUPPORT_SESSION_ADMIN_BACKUP_KEY);
  if (!raw) return null;
  const backup = JSON.parse(raw) as Session;
  const { error } = await supabase.auth.setSession({
    access_token: backup.access_token,
    refresh_token: backup.refresh_token,
  });
  if (error) throw error;
  return backup;
}

export function clearSupportSessionState() {
  window.localStorage.removeItem(SUPPORT_SESSION_STATE_KEY);
  window.localStorage.removeItem(SUPPORT_SESSION_ADMIN_BACKUP_KEY);
}

function stripActionLink(session: SupportSessionStartResult): LocalSupportSession {
  const { action_link: _actionLink, ...safeSession } = session;
  return safeSession;
}