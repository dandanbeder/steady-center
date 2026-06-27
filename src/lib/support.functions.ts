import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const SUPPORT_INBOX = "support@flightmed.software";

const InputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Valid email required").max(255),
  message: z.string().trim().min(5, "Please describe your issue").max(5000),
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send a support request to the Heartbeat support inbox via the
 * Resend connector gateway. Auth-gated (requires a signed-in user)
 * and validated server-side; the user's id is recorded in the email
 * so the support team can correlate without trusting the client.
 *
 * RLS: this function writes no app tables, it only forwards an
 * email through the gateway. The Supabase Auth middleware ensures
 * only authenticated users can call it; no other data is read or
 * written, so no additional RLS surface is exposed.
 */
export const sendSupportEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    if (!lovableKey || !resendKey) {
      throw new Error("Support email is not configured. Please try again later.");
    }

    const userId = context.userId;
    const safeName = escapeHtml(data.name);
    const safeEmail = escapeHtml(data.email);
    const safeMessage = escapeHtml(data.message).replace(/\n/g, "<br/>");

    const subject = `Heartbeat support, ${data.name}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color:#111; line-height:1.5;">
        <h2 style="margin:0 0 12px 0;">New support request</h2>
        <p style="margin:0 0 6px 0;"><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
        <p style="margin:0 0 16px 0; color:#666; font-size:12px;"><strong>User ID:</strong> ${userId}</p>
        <div style="border-left:3px solid #ccc; padding:8px 12px; background:#fafafa;">${safeMessage}</div>
      </div>
    `;
    const text = `New support request\nFrom: ${data.name} <${data.email}>\nUser ID: ${userId}\n\n${data.message}`;

    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: "Heartbeat Support <onboarding@resend.dev>",
        to: [SUPPORT_INBOX],
        reply_to: data.email,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
      throw new Error(
        `Couldn't send support message (status ${res.status}). ${detail.slice(0, 200)}`,
      );
    }

    return { ok: true as const };
  });
