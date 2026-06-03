import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendMarketingEmail,
  getUnsubscribeToken,
  unsubscribeUrlFor,
  preferencesUrl,
  brandedMarketingEmail,
  sendEmail,
} from "@/lib/email.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

export interface SubscriberRow {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  subscription_status: "trial" | "active" | "canceled" | "past_due" | "none";
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
}

/** List every account with marketing + subscription state (superadmin only). */
export const adminListSubscribers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriberRow[]> => {
    await requirePlatformAdmin(context.userId);

    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);

    const ids = authData.users.map((u) => u.id);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, subscription_status, marketing_opt_in, marketing_opt_in_at")
      .in("id", ids);

    const pmap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
    return authData.users.map((u) => {
      const p = pmap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: (p?.full_name as string) ?? "",
        created_at: u.created_at,
        subscription_status:
          (p?.subscription_status as SubscriberRow["subscription_status"]) ?? "trial",
        marketing_opt_in: Boolean(p?.marketing_opt_in),
        marketing_opt_in_at: (p?.marketing_opt_in_at as string | null) ?? null,
      };
    });
  });

/** Compose & send a branded product-update email to all opted-in subscribers. */
export const adminSendSubscriberCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        subject: z.string().min(3).max(200),
        heading: z.string().min(3).max(200),
        intro: z.string().min(1).max(1000),
        bodyHtml: z.string().max(20000).optional(),
        ctaLabel: z.string().max(80).optional(),
        ctaUrl: z.string().url().max(500).optional(),
        testTo: z.string().email().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);

    // Test send: bypass opt-in check, send a single preview to the requested address.
    if (data.testTo) {
      const token = await getUnsubscribeToken(context.userId);
      const unsubscribeUrl = token
        ? unsubscribeUrlFor(token)
        : `${preferencesUrl()}`;
      const html = brandedMarketingEmail({
        heading: data.heading,
        intro: data.intro,
        bodyHtml: data.bodyHtml,
        ctaLabel: data.ctaLabel,
        ctaUrl: data.ctaUrl,
        unsubscribeUrl,
        preferencesUrl: preferencesUrl(),
      });
      await sendEmail({
        to: data.testTo,
        subject: `[TEST] ${data.subject}`,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      return { sent: 1, skipped: 0, test: true };
    }

    // Bulk send: only opted-in users.
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, marketing_opt_in")
      .eq("marketing_opt_in", true);
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length === 0) return { sent: 0, skipped: 0 };

    // Look up emails from auth.
    const { data: authData, error: aErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (aErr) throw new Error(aErr.message);
    const emailById = new Map(authData.users.map((u) => [u.id, u.email ?? ""]));

    let sent = 0;
    let skipped = 0;
    for (const userId of ids) {
      const to = emailById.get(userId);
      if (!to) {
        skipped++;
        continue;
      }
      try {
        const result = await sendMarketingEmail({
          userId,
          to,
          subject: data.subject,
          heading: data.heading,
          intro: data.intro,
          bodyHtml: data.bodyHtml,
          ctaLabel: data.ctaLabel,
          ctaUrl: data.ctaUrl,
        });
        if (result.sent) sent++;
        else skipped++;
      } catch (e) {
        console.error("[subscribers] send failed", userId, e);
        skipped++;
      }
    }
    return { sent, skipped };
  });

/** Update a subscriber's subscription status (superadmin only). */
export const adminSetSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      user_id: z.string().uuid(),
      subscription_status: z.enum(["trial", "active", "canceled", "past_due", "none"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ subscription_status: data.subscription_status })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
