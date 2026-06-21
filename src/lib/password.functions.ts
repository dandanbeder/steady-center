import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, getAppOrigin, sendEmail } from "./email.server";

const RESET_RATE_PER_HOUR = 3;

function hashEmail(email: string) {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/**
 * Request a password reset. Always returns ok=true regardless of whether the
 * email is registered, we do not reveal account existence. Rate-limited per
 * email (hashed) to 3 attempts per rolling hour.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ email: z.string().email().max(320) }).parse(i),
  )
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const eh = hashEmail(email);

    // Rate-limit: count attempts in the last hour for this email.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("password_reset_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email_hash", eh)
      .gte("attempted_at", since);

    if ((count ?? 0) >= RESET_RATE_PER_HOUR) {
      // Silently succeed, don't leak that we throttled this specific email.
      return { ok: true };
    }

    await supabaseAdmin
      .from("password_reset_attempts")
      .insert({ email_hash: eh });

    const origin = getAppOrigin();
    const redirectTo = `${origin}/reset-password`;

    // Generate a recovery link via the admin API. If the user doesn't exist
    // this returns an error, we swallow it so we don't reveal existence.
    const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error || !linkData?.properties?.action_link) {
      console.warn("[password-reset] generateLink failed", error?.message);
      return { ok: true };
    }

    const actionLink = linkData.properties.action_link;
    const html = brandedEmail({
      heading: "Reset your Heartbeat password",
      intro:
        "We received a request to reset your Heartbeat password. Click the button below to choose a new one. This link expires in one hour.",
      ctaLabel: "Set a new password",
      ctaUrl: actionLink,
      footer:
        "If you didn't request this, you can safely ignore this email, your password won't change.",
    });

    await sendEmail({
      to: email,
      subject: "Reset your Heartbeat password",
      html,
    });

    return { ok: true };
  });

/**
 * Change the signed-in user's password after verifying their current password.
 * Verification happens server-side by attempting a fresh sign-in with the
 * provided current password; the new password is then set via the admin API.
 */
export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z
      .object({
        current_password: z.string().min(1).max(200),
        new_password: z
          .string()
          .min(8, "At least 8 characters")
          .max(200)
          .refine(
            (p) => /[A-Za-z]/.test(p) && /\d/.test(p),
            "Must include a letter and a number",
          ),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: userRes, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !userRes.user?.email) {
      throw new Error("Could not load your account");
    }
    const email = userRes.user.email;

    // Verify current password using a throwaway anon client.
    const verify = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInErr } = await verify.auth.signInWithPassword({
      email,
      password: data.current_password,
    });
    if (signInErr) {
      throw new Error("Current password is incorrect");
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: data.new_password },
    );
    if (updErr) throw new Error(updErr.message);

    return { ok: true };
  });
