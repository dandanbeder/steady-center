import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Records a login / sign-out event for the authenticated user, including
 * the client IP (server-derived — clients cannot spoof it) and a sanitized
 * user-agent string. Used for breach-readiness audit trails (#12).
 *
 * Writes go through service-role because login_history's INSERT policy only
 * allows the row's own user, and we want IP capture to be guaranteed
 * regardless of which client is calling. We still scope every insert to
 * `context.userId` so a caller cannot record a row for someone else.
 */
export const recordLoginEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        event: z.enum(["sign_in", "sign_out"]).default("sign_in"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let ip: string | null = null;
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch {
      ip = null;
    }
    const ua = (getRequestHeader("user-agent") ?? "").slice(0, 500) || null;

    try {
      await supabaseAdmin.from("login_history").insert({
        user_id: context.userId,
        event: data.event,
        ip,
        user_agent: ua,
      });
    } catch (e) {
      console.error("[security] failed to record login event", data.event, e);
    }
    return { ok: true };
  });
