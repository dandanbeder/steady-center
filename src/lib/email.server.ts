// Server-only email helper. Centralizes the sender address + Resend call so
// every outbound email uses our verified domain.
//
// Deliverability note: flightmed.software must be verified in Resend before
// any of these emails will actually land. Until then, Resend will reject the
// send with a domain-not-verified error.

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

/** Branded email shell — warm tone, evergreen theme, optional CTA. */
export function brandedEmail(opts: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const logo = `${getAppOrigin()}/favicon.svg`;
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:28px 0">
           <a href="${opts.ctaUrl}" style="background:#7A8471;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:500">${escapeHtml(opts.ctaLabel)}</a>
         </p>`
      : "";
  return `<!doctype html>
<html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      <img src="${logo}" alt="Heartbeat" width="28" height="28" style="display:inline-block;vertical-align:middle"/>
      <strong style="font-size:18px;color:#3D4A36">Heartbeat</strong>
    </div>
    <h1 style="font-size:22px;margin:0 0 12px;color:#1a1a1a">${escapeHtml(opts.heading)}</h1>
    <p style="margin:0 0 16px;line-height:1.55;color:#3a3a3a">${escapeHtml(opts.intro)}</p>
    ${opts.bodyHtml ?? ""}
    ${cta}
    ${opts.footer ? `<p style="color:#888;font-size:12px;margin-top:32px;line-height:1.5">${escapeHtml(opts.footer)}</p>` : ""}
    <p style="color:#aaa;font-size:11px;margin-top:24px">Heartbeat · Powered by FlightMed (PTY) Ltd</p>
  </div>
</body></html>`;
}
