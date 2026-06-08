// Admin-only readers for analytics_events. Inserts happen in DB triggers
// (see migration 20260608_*_analytics_events), so there's no client writer here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requirePlatformAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.platform_role !== "superadmin") throw new Error("Not authorized");
}

export const ANALYTICS_EVENT_TYPES = [
  "signup",
  "login",
  "account_created",
  "calendar_connected",
  "task_created",
  "note_created",
  "meeting_created",
  "ai_action_used",
  "plan_changed",
  "trial_started",
  "trial_converted",
  "subscription_canceled",
  "payment_failed",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/** Recent analytics events for the admin dashboard. */
export const listAnalyticsEvents = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { types?: AnalyticsEventType[]; since?: string; limit?: number }) =>
    z
      .object({
        types: z.array(z.enum(ANALYTICS_EVENT_TYPES)).optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    let q = supabaseAdmin
      .from("analytics_events")
      .select("id, user_id, account_id, type, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.types?.length) q = q.in("type", data.types);
    if (data.since) q = q.gte("created_at", data.since);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { events: rows ?? [] };
  });

/** Daily counts per event type for the last N days. */
export const analyticsCountsByDay = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { days?: number; types?: AnalyticsEventType[] }) =>
    z
      .object({
        days: z.number().int().min(1).max(180).optional(),
        types: z.array(z.enum(ANALYTICS_EVENT_TYPES)).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    let q = supabaseAdmin
      .from("analytics_events")
      .select("type, created_at")
      .gte("created_at", since);
    if (data.types?.length) q = q.in("type", data.types);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows ?? []) {
      const day = (r.created_at as string).slice(0, 10);
      const t = r.type as string;
      const b = buckets.get(day) ?? {};
      b[t] = (b[t] ?? 0) + 1;
      buckets.set(day, b);
    }
    const series = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, counts }));
    return { series, totalRows: rows?.length ?? 0 };
  });
