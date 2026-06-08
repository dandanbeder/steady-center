import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { brandedEmail, sendEmail, getAppOrigin } from "./email.server";

/** Look up a token, return the masked email if valid + current opt-in state. */
export const getUnsubscribeInfo = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("user_id, used_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { valid: false as const };
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    const email = u.user?.email ?? "";
    const masked = maskEmail(email);
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("marketing_opt_in")
      .eq("id", row.user_id)
      .maybeSingle();
    return {
      valid: true as const,
      email: masked,
      alreadyOptedOut: prof?.marketing_opt_in === false,
    };
  });

/** Confirm one-click unsubscribe — flips marketing_opt_in off + sends a receipt. */
export const confirmUnsubscribe = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("user_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { ok: false as const, reason: "invalid" };

    await supabaseAdmin
      .from("profiles")
      .update({ marketing_opt_in: false, marketing_opt_in_at: null })
      .eq("id", row.user_id);

    await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", data.token);

    const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    const email = u.user?.email;
    if (email) {
      const origin = getAppOrigin();
      const html = brandedEmail({
        heading: "You've been unsubscribed",
        intro:
          "You won't receive any more product updates or weekly review emails from Heartbeat. We'll still send essential account messages like password resets and security alerts.",
        bodyHtml: `<p style="color:#3a3a3a;line-height:1.55">Changed your mind? You can re-enable product updates any time from your email preferences.</p>`,
        ctaLabel: "Open preferences",
        ctaUrl: `${origin}/settings?panel=notifications`,
        footer: "If this wasn't you, please sign in and review your account.",
      });
      await sendEmail({
        to: email,
        subject: "Unsubscribed from Heartbeat product updates",
        html,
      });
    }
    return { ok: true as const };
  });

/** Authenticated: read the current user's marketing opt-in state. */
export const getMarketingOptIn = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("profiles")
      .select("marketing_opt_in")
      .eq("id", userId)
      .maybeSingle();
    return { optedIn: data?.marketing_opt_in === true };
  });

/** Authenticated: toggle marketing opt-in on/off from the preferences UI. */
export const setMarketingOptIn = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ optedIn: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        marketing_opt_in: data.optedIn,
        marketing_opt_in_at: data.optedIn ? new Date().toISOString() : null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local[0] ?? "" : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}
