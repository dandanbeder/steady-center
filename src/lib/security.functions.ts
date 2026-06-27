import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Records a login / sign-out event for the authenticated user, including
 * the client IP (server-derived, clients cannot spoof it) and a sanitized
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

/**
 * Approximate IP geolocation for the Login history detail view.
 * Uses the free ipapi.co endpoint (no key, ~1k req/day). Result is
 * intentionally coarse — city + country only — and always labelled
 * "approximate" in the UI. Returns null on any failure.
 */
export const geolocateIp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ ip: z.string().min(1).max(64) }).parse(i))
  .handler(async ({ data }) => {
    // Skip obvious private / unroutable addresses.
    if (
      /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc|fd|fe80)/i.test(
        data.ip,
      )
    ) {
      return { city: null, region: null, country: null, label: "Local network" };
    }
    try {
      const r = await fetch(`https://ipapi.co/${encodeURIComponent(data.ip)}/json/`, {
        headers: { "user-agent": "heartbeat-login-history" },
      });
      if (!r.ok) return null;
      const j = (await r.json()) as {
        city?: string;
        region?: string;
        country_name?: string;
        error?: boolean;
      };
      if (j.error) return null;
      const parts = [j.city, j.region, j.country_name].filter(Boolean) as string[];
      return {
        city: j.city ?? null,
        region: j.region ?? null,
        country: j.country_name ?? null,
        label: parts.length ? parts.join(", ") : null,
      };
    } catch {
      return null;
    }
  });
