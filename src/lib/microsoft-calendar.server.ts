/**
 * Server-only helpers for Microsoft Graph calendar integration.
 *
 * - OAuth token refresh (using stored refresh_token).
 * - Authenticated Graph fetch that retries once on 401 after a refresh.
 * - Signed state helpers for the OAuth handshake.
 *
 * Filename ends in `.server.ts` so the Vite import-protection blocks any
 * accidental client import. Service-role tokens never leave this module.
 */
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MS_AUTHORITY = "https://login.microsoftonline.com/common";
export const MS_GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Calendars.ReadWrite",
].join(" ");

export function getMsRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/microsoft/callback`;
}

function clientCreds() {
  const id = process.env.MS_CLIENT_ID;
  const secret = process.env.MS_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Microsoft is not configured, MS_CLIENT_ID / MS_CLIENT_SECRET secrets missing.",
    );
  }
  return { id, secret };
}

function stateSecret(): string {
  const s = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("State signing secret missing");
  return s;
}

export function signOAuthState(userId: string, redirectUri: string): string {
  const payload = {
    u: userId,
    r: redirectUri,
    n: randomBytes(12).toString("hex"),
    t: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): { userId: string; redirectUri: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  try {
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed?.u || !parsed?.r) return null;
    // 1 hour max state lifetime
    if (Date.now() - Number(parsed.t || 0) > 60 * 60 * 1000) return null;
    return { userId: String(parsed.u), redirectUri: String(parsed.r) };
  } catch {
    return null;
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: MS_SCOPES,
  });
  const r = await fetch(`${MS_AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Microsoft token exchange failed ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json() as Promise<TokenResponse>;
}

async function refreshAccessToken(userId: string): Promise<string> {
  const { id, secret } = clientCreds();
  const { data: row, error } = await supabaseAdmin
    .from("ms_oauth_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.refresh_token) throw new Error("MS_NOT_CONNECTED");

  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    scope: MS_SCOPES,
  });
  const r = await fetch(`${MS_AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    // Token revoked / invalid → mark for reconnect
    await supabaseAdmin
      .from("ms_oauth_tokens")
      .update({ needs_reconnect: true })
      .eq("user_id", userId);
    throw new Error(`MS_REFRESH_FAILED: ${r.status} ${text.slice(0, 200)}`);
  }
  const tok = (await r.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  await supabaseAdmin
    .from("ms_oauth_tokens")
    .update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? row.refresh_token,
      expires_at: expiresAt,
      scope: tok.scope ?? null,
      needs_reconnect: false,
    })
    .eq("user_id", userId);
  return tok.access_token;
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from("ms_oauth_tokens")
    .select("access_token, expires_at, needs_reconnect")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("MS_NOT_CONNECTED");
  if (row.needs_reconnect) throw new Error("MS_NEEDS_RECONNECT");

  const expiresMs = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresMs) && expiresMs - Date.now() > 5 * 60 * 1000) {
    return row.access_token;
  }
  return refreshAccessToken(userId);
}

export async function graphFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = await getValidAccessToken(userId);
  const url = path.startsWith("http") ? path : `${MS_GRAPH}${path}`;
  const doFetch = (t: string) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refreshAccessToken(userId);
    res = await doFetch(token);
  }
  return res;
}

export async function graphJson<T = unknown>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await graphFetch(userId, path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MS Graph ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Persist a fresh token bundle for a user (called from OAuth callback). */
export async function persistTokens(
  userId: string,
  tok: TokenResponse,
  accountEmail: string | null,
  tenantId: string | null,
) {
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  if (!tok.refresh_token) {
    throw new Error("Microsoft did not return a refresh token, make sure offline_access scope is requested.");
  }
  const { error } = await supabaseAdmin.from("ms_oauth_tokens").upsert(
    {
      user_id: userId,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: expiresAt,
      account_email: accountEmail,
      scope: tok.scope ?? null,
      tenant_id: tenantId,
      needs_reconnect: false,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

/** Decode the `email` claim from the id_token (no signature verification needed, server-side). */
export function emailFromIdToken(idToken?: string): { email: string | null; tid: string | null } {
  if (!idToken) return { email: null, tid: null };
  const parts = idToken.split(".");
  if (parts.length < 2) return { email: null, tid: null };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return {
      email: payload.email ?? payload.preferred_username ?? payload.upn ?? null,
      tid: payload.tid ?? null,
    };
  } catch {
    return { email: null, tid: null };
  }
}
