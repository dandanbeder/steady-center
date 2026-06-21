import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Records the authenticated user's acceptance of the Terms and Privacy
 * Policy, plus their marketing-opt-in choice. Used after first OAuth
 * sign-in (where consent could not be captured before redirect) and
 * whenever consent is otherwise missing on the profile.
 *
 * `terms_accepted_at` is a protected column (guarded by
 * profiles_guard_self_update), so the write goes through the trusted
 * service-role client.
 */
export const acceptTermsAndPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        marketing_opt_in: z.boolean().optional().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const nowIso = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("terms_accepted_at, marketing_opt_in, marketing_opt_in_at")
      .eq("id", userId)
      .maybeSingle();

    const patch: {
      terms_accepted_at?: string;
      marketing_opt_in?: boolean;
      marketing_opt_in_at?: string | null;
    } = {};
    if (!existing?.terms_accepted_at) patch.terms_accepted_at = nowIso;
    if (data.marketing_opt_in && !existing?.marketing_opt_in) {
      patch.marketing_opt_in = true;
      patch.marketing_opt_in_at = nowIso;
    } else if (!data.marketing_opt_in && existing?.marketing_opt_in) {
      // User opted out at the consent screen, clear the flag.
      patch.marketing_opt_in = false;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
