// Server-only email helper. Centralizes the sender address + Resend call so
// every outbound email uses our verified domain.
//
// Deliverability note: flightmed.software must be verified in Resend before
// any of these emails will actually land. Until then, Resend will reject the
// send with a domain-not-verified error.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_URL = "https://connector-gateway.lovable.dev/resend/emails";

export const EMAIL_FROM = "Heartbeat <noreply@flightmed.software>";
export const EMAIL_REPLY_TO_DEFAULT = "noreply@flightmed.software";

export function getAppOrigin(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://steady-center.lovable.app"
  );
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

export interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
  headers?: Record<string, string>;
}

/** Send an email via Resend through the Lovable connector gateway. */
export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const conn = process.env.RESEND_API_KEY;
  if (!apiKey || !conn) {
    console.warn("[email] missing credentials; skipping email to", opts.to);
    return;
  }
  const body: Record<string, unknown> = {
    from: opts.from ?? EMAIL_FROM,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  if (opts.headers) body.headers = opts.headers;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Connection-Api-Key": conn,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("[email] resend failed", res.status, (await res.text()).slice(0, 400));
  }
}

// Company / support constants for email footers.
export const SUPPORT_EMAIL = "hello@flightmed.software";
export const COMPANY_LEGAL_NAME = "FlightMed (PTY) Ltd";
export const COMPANY_ADDRESS = "Cape Town, South Africa";

function brandFooter(): string {
  const year = new Date().getUTCFullYear();
  const origin = getAppOrigin();
  return `
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px"/>
    <p style="color:#888;font-size:12px;line-height:1.6;margin:0">
      © ${year} ${escapeHtml(COMPANY_LEGAL_NAME)} ·
      <a href="${origin}/terms" style="color:#7A8471;text-decoration:none">Terms</a> ·
      <a href="${origin}/privacy" style="color:#7A8471;text-decoration:none">Privacy</a> ·
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#7A8471;text-decoration:none">${SUPPORT_EMAIL}</a>
    </p>
    <p style="color:#aaa;font-size:11px;line-height:1.5;margin:6px 0 0">
      ${escapeHtml(COMPANY_LEGAL_NAME)} · ${escapeHtml(COMPANY_ADDRESS)}
    </p>`;
}

function shellHead(): string {
  // Hosted PNG (works in every email client; SVG is not reliable in mail).
  const logo = `${getAppOrigin()}/__l5e/assets-v1/3c0015b6-31f1-42ce-927f-58c5397b38f4/heartbeat-email-logo.png`;
  return `<div style="margin-bottom:24px">
      <img src="${logo}" alt="Heartbeat" width="220" style="display:block;height:auto;max-width:220px;border:0;outline:none;text-decoration:none"/>
    </div>`;
}

/** Branded email shell — warm tone, evergreen theme, optional CTA. */
export function brandedEmail(opts: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Optional small note rendered just under the CTA. */
  ctaNoteHtml?: string;
  /** Optional small grey line above the legal footer. */
  footer?: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:28px 0 8px">
           <a href="${opts.ctaUrl}" style="background:#7A8471;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:500">${escapeHtml(opts.ctaLabel)}</a>
         </p>`
      : "";
  const ctaNote = opts.ctaNoteHtml
    ? `<p style="margin:4px 0 0;color:#6b6b6b;font-size:13px;line-height:1.55">${opts.ctaNoteHtml}</p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${shellHead()}
    <h1 style="font-size:22px;margin:0 0 12px;color:#1a1a1a">${escapeHtml(opts.heading)}</h1>
    <p style="margin:0 0 16px;line-height:1.55;color:#3a3a3a">${escapeHtml(opts.intro)}</p>
    ${opts.bodyHtml ?? ""}
    ${cta}
    ${ctaNote}
    ${opts.footer ? `<p style="color:#888;font-size:12px;margin-top:24px;line-height:1.5">${escapeHtml(opts.footer)}</p>` : ""}
    ${brandFooter()}
    <p style="color:#aaa;font-size:11px;margin-top:12px">This is a service notification from Heartbeat. You're receiving it because of activity on your account.</p>
  </div>
</body></html>`;
}

/**
 * Marketing / product-update email shell. Includes a visible unsubscribe link
 * and a List-Unsubscribe header. Use ONLY for product updates, weekly reviews,
 * and other non-transactional emails. Auth / billing / security notifications
 * must use brandedEmail() instead.
 */
export function brandedMarketingEmail(opts: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:28px 0">
           <a href="${opts.ctaUrl}" style="background:#7A8471;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:500">${escapeHtml(opts.ctaLabel)}</a>
         </p>`
      : "";
  return `<!doctype html>
<html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${shellHead()}
    <h1 style="font-size:22px;margin:0 0 12px;color:#1a1a1a">${escapeHtml(opts.heading)}</h1>
    <p style="margin:0 0 16px;line-height:1.55;color:#3a3a3a">${escapeHtml(opts.intro)}</p>
    ${opts.bodyHtml ?? ""}
    ${cta}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px"/>
    <p style="color:#888;font-size:12px;line-height:1.6;margin:0">
      You're receiving this because product updates are turned on for your Heartbeat account.<br/>
      <a href="${opts.preferencesUrl}" style="color:#7A8471">Manage email preferences</a>
      &nbsp;·&nbsp;
      <a href="${opts.unsubscribeUrl}" style="color:#7A8471">Unsubscribe in one click</a>
    </p>
    <p style="color:#aaa;font-size:11px;margin-top:16px">© ${new Date().getUTCFullYear()} ${escapeHtml(COMPANY_LEGAL_NAME)} · ${escapeHtml(COMPANY_ADDRESS)}</p>
  </div>
</body></html>`;
}

/** Fetch (or create) the recipient's one-click unsubscribe token. */
export async function getUnsubscribeToken(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_or_create_unsubscribe_token", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[email] unsubscribe token error", error.message);
    return null;
  }
  return (data as string) ?? null;
}

export function unsubscribeUrlFor(token: string): string {
  return `${getAppOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function preferencesUrl(): string {
  return `${getAppOrigin()}/settings?panel=notifications`;
}

/**
 * Returns true when we are allowed to send a marketing/product-update email
 * to this user (account exists and they have not opted out).
 */
export async function canSendMarketing(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("marketing_opt_in")
    .eq("id", userId)
    .maybeSingle();
  return data?.marketing_opt_in === true;
}

/**
 * Send a marketing email, automatically gated on the user's marketing_opt_in
 * flag and stamped with one-click unsubscribe headers + footer.
 */
export async function sendMarketingEmail(opts: {
  userId: string;
  to: string;
  subject: string;
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!(await canSendMarketing(opts.userId))) {
    return { sent: false, reason: "opted_out" };
  }
  const token = await getUnsubscribeToken(opts.userId);
  if (!token) return { sent: false, reason: "token_unavailable" };

  const unsubscribeUrl = unsubscribeUrlFor(token);
  const html = brandedMarketingEmail({
    heading: opts.heading,
    intro: opts.intro,
    bodyHtml: opts.bodyHtml,
    ctaLabel: opts.ctaLabel,
    ctaUrl: opts.ctaUrl,
    unsubscribeUrl,
    preferencesUrl: preferencesUrl(),
  });
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  return { sent: true };
}
