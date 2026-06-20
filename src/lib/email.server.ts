// Server-only email helper. Centralizes the sender address, the shared
// brand layout (header / body slot / footer) and the Resend call so every
// outbound email looks and feels the same.
//
// All emails are sent multipart (HTML + plain text). Reply-to defaults to
// hello@flightmed.software so recipients can just hit reply. Send-from is
// always Heartbeat <noreply@flightmed.software>.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_URL = "https://connector-gateway.lovable.dev/resend/emails";

export const EMAIL_FROM = "Heartbeat <noreply@flightmed.software>";
export const SUPPORT_EMAIL = "hello@flightmed.software";
export const EMAIL_REPLY_TO_DEFAULT = SUPPORT_EMAIL;
export const COMPANY_LEGAL_NAME = "FlightMed (PTY) Ltd";
export const COMPANY_ADDRESS = "Cape Town, South Africa";

// ----- Brand tokens (inline CSS only — email clients ignore stylesheets) ----
const BRAND = {
  paper: "#F5EFE3",       // warm paper / outer + header band
  card: "#FFFFFF",        // body card
  ink: "#1F2A24",         // primary text (deep evergreen)
  body: "#3A3A3A",        // body copy
  muted: "#7A7A7A",       // small print
  sage: "#7A8471",        // primary CTA + links
  sageDark: "#5F6A56",    // pressed / strong link
  hairline: "#E7E2D6",    // divider
};

const LOGO_URL =
  "https://www.heartbeatcommand.software/__l5e/assets-v1/3c0015b6-31f1-42ce-927f-58c5397b38f4/heartbeat-email-logo.png";

export function getAppOrigin(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://www.heartbeatcommand.software"
  );
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

/** Cheap HTML → plain-text fallback for the multipart `text` part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  /** Optional explicit plain-text. Auto-derived from HTML when omitted. */
  text?: string;
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
    text: opts.text ?? htmlToText(opts.html),
    reply_to: opts.replyTo ?? EMAIL_REPLY_TO_DEFAULT,
  };
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

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

/** Hidden preview-pane text that mail clients show next to the subject. */
function preheaderBlock(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.paper};opacity:0">${escapeHtml(text)}</div>`;
}

function headerBand(): string {
  return `
  <tr>
    <td align="center" style="background:${BRAND.paper};padding:24px 24px 20px;border-bottom:1px solid ${BRAND.hairline};border-top-left-radius:14px;border-top-right-radius:14px">
      <img src="${LOGO_URL}" alt="Heartbeat" width="200" height="44" style="display:block;height:auto;max-width:200px;border:0;outline:none;text-decoration:none"/>
    </td>
  </tr>`;
}

function footerRow(opts: { marketing?: { unsubscribeUrl: string; preferencesUrl: string } }): string {
  const year = new Date().getUTCFullYear();
  const origin = getAppOrigin();
  const marketing = opts.marketing
    ? `
      <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:12px;line-height:1.6">
        <a href="${opts.marketing.preferencesUrl}" style="color:${BRAND.sage};text-decoration:none">Manage email preferences</a>
        &nbsp;·&nbsp;
        <a href="${opts.marketing.unsubscribeUrl}" style="color:${BRAND.sage};text-decoration:none">Unsubscribe in one click</a>
      </p>`
    : "";
  return `
  <tr>
    <td style="background:${BRAND.paper};padding:20px 28px 24px;border-top:1px solid ${BRAND.hairline};border-bottom-left-radius:14px;border-bottom-right-radius:14px" align="center">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:13px;line-height:1.6">
        Questions? Reply to this email or contact
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.sage};text-decoration:none">${SUPPORT_EMAIL}</a>.
      </p>
      <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:12px;line-height:1.6">
        © ${year} ${escapeHtml(COMPANY_LEGAL_NAME)} ·
        <a href="${origin}/terms" style="color:${BRAND.sage};text-decoration:none">Terms</a> ·
        <a href="${origin}/privacy" style="color:${BRAND.sage};text-decoration:none">Privacy</a>
      </p>
      <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:11px;line-height:1.5">
        ${escapeHtml(COMPANY_LEGAL_NAME)}
      </p>
      ${marketing}
    </td>
  </tr>`;
}

/** Wraps any inner HTML in the shared header + body card + footer shell. */
function wrapLayout(opts: {
  preheader?: string;
  bodyInnerHtml: string;
  marketing?: { unsubscribeUrl: string; preferencesUrl: string };
}): string {
  const preheader = opts.preheader ? preheaderBlock(opts.preheader) : "";
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>Heartbeat</title>
</head>
<body style="margin:0;padding:0;background:#EFE9DC;-webkit-text-size-adjust:100%">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EFE9DC">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${BRAND.card};border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
        ${headerBand()}
        <tr>
          <td style="background:${BRAND.card};padding:28px 28px 8px">
            ${opts.bodyInnerHtml}
          </td>
        </tr>
        ${footerRow({ marketing: opts.marketing })}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Render the inner body block (heading, intro, body, CTA, note). */
function renderBody(opts: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaNoteHtml?: string;
}): string {
  const headingFont = `'Georgia','Times New Roman',Times,serif`;
  const bodyFont = `Arial,Helvetica,sans-serif`;
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px">
          <tr><td bgcolor="${BRAND.sage}" style="border-radius:10px">
            <a href="${opts.ctaUrl}" style="display:inline-block;padding:13px 26px;font-family:${bodyFont};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(opts.ctaLabel)}</a>
          </td></tr>
        </table>`
      : "";
  const ctaNote = opts.ctaNoteHtml
    ? `<p style="margin:4px 0 18px;font-family:${bodyFont};color:${BRAND.muted};font-size:13px;line-height:1.55">${opts.ctaNoteHtml}</p>`
    : `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>`;
  return `
    <h1 style="margin:0 0 14px;font-family:${headingFont};font-size:24px;line-height:1.3;color:${BRAND.ink};font-weight:600">${escapeHtml(opts.heading)}</h1>
    <p style="margin:0 0 16px;font-family:${bodyFont};font-size:16px;line-height:1.6;color:${BRAND.body}">${escapeHtml(opts.intro)}</p>
    ${opts.bodyHtml ?? ""}
    ${cta}
    ${ctaNote}`;
}

/** Branded transactional email shell (no unsubscribe). */
export function brandedEmail(opts: {
  heading: string;
  intro: string;
  /** Hidden preview text (shown in inbox preview, ~80 chars). */
  preheader?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Optional small note rendered just under the CTA. */
  ctaNoteHtml?: string;
  /** Legacy: small grey line above the legal footer. Kept for callers. */
  footer?: string;
}): string {
  const trailing = opts.footer
    ? `<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:12px;line-height:1.55">${escapeHtml(opts.footer)}</p>`
    : "";
  return wrapLayout({
    preheader: opts.preheader ?? opts.intro,
    bodyInnerHtml: renderBody(opts) + trailing,
  });
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
  preheader?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
}): string {
  return wrapLayout({
    preheader: opts.preheader ?? opts.intro,
    bodyInnerHtml: renderBody(opts),
    marketing: { unsubscribeUrl: opts.unsubscribeUrl, preferencesUrl: opts.preferencesUrl },
  });
}

// ---------------------------------------------------------------------------
// Marketing helpers (unchanged)
// ---------------------------------------------------------------------------

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

export async function canSendMarketing(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("marketing_opt_in")
    .eq("id", userId)
    .maybeSingle();
  return data?.marketing_opt_in === true;
}

export async function sendMarketingEmail(opts: {
  userId: string;
  to: string;
  subject: string;
  heading: string;
  intro: string;
  preheader?: string;
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
    preheader: opts.preheader,
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
