import { supabase } from "@/integrations/supabase/client";
import { recordLoginEvent } from "@/lib/security.functions";

export type LoginEvent = {
  id: string;
  user_id: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
};

export async function recordLogin(event: "sign_in" | "sign_out" = "sign_in") {
  // Server-side capture so the IP is the real client IP (set by the edge),
  // not whatever a tampered client claims. Falls back silently, login
  // history is best-effort and must never block auth.
  try {
    await recordLoginEvent({ data: { event } });
  } catch (e) {
    console.warn("[security] recordLogin failed", e);
  }
}

export async function listLoginHistory(limit = 25): Promise<LoginEvent[]> {
  const { data, error } = await supabase
    .from("login_history")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as LoginEvent[];
}

// ---------- MFA (TOTP) ----------
// Server-side enforcement: Supabase Auth verifies TOTP codes on its own
// server and elevates the session AAL, clients cannot bypass.

export async function listMfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data;
}

export async function enrollTotp(friendlyName = "Authenticator app") {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error) throw error;
  return data; // { id, type, totp: { qr_code, secret, uri } }
}

export async function verifyTotpEnrollment(factorId: string, code: string) {
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr) throw cErr;
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (error) throw error;
}

export async function unenrollFactor(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function getAuthAal() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data; // { currentLevel, nextLevel }
}

export async function signOutOtherSessions() {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) throw error;
}
