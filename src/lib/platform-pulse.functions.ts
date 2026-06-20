// Super-admin controls for the Platform Pulse digest.
// - List recipients (cadence + last-sent-at) for the admin UI.
// - Update a super-admin's own cadence.
// - Send an immediate test digest to the caller.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { sendEmail } from "./email.server";
import { computePulse, renderPulseEmail } from "./platform-pulse-generator.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

const cadenceSchema = z.enum(["off", "daily", "weekly"]);

export const adminListPulseRecipients = createServerFn({ method: "GET" })
  .middleware([requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, platform_pulse_cadence, platform_pulse_last_sent_at, full_name")
      .eq("platform_role", "superadmin")
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const rows: Array<{
      user_id: string;
      email: string;
      full_name: string | null;
      cadence: "off" | "daily" | "weekly";
      last_sent_at: string | null;
    }> = [];
    for (const r of data ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.id);
      rows.push({
        user_id: r.id,
        email: u.user?.email ?? "(unknown)",
        full_name: r.full_name ?? null,
        cadence: (r.platform_pulse_cadence ?? "off") as "off" | "daily" | "weekly",
        last_sent_at: r.platform_pulse_last_sent_at ?? null,
      });
    }
    return { recipients: rows };
  });

export const adminSetPulseCadence = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((i) =>
    z.object({ user_id: z.string().uuid(), cadence: cadenceSchema }).parse(i),
  )
  .handler(async ({ data }) => {
    // Only super-admins can be recipients.
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("platform_role")
      .eq("id", data.user_id)
      .maybeSingle();
    if (target?.platform_role !== "superadmin") {
      throw new Error("Only super-admins can receive the Platform Pulse.");
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ platform_pulse_cadence: data.cadence })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Send a one-off test digest to the calling super-admin immediately. */
export const adminSendPulseTest = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((i) =>
    z.object({ window: z.enum(["daily", "weekly"]).default("daily") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = u.user?.email;
    if (!email) throw new Error("Calling super-admin has no email on file.");
    const rendered = renderPulseEmail(await computePulse(data.window));
    await sendEmail({ to: email, subject: `[TEST] ${rendered.subject}`, html: rendered.html });
    return { ok: true, sent_to: email };
  });
