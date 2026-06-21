// Server-only generator for the admin "Platform Pulse" digest.
// Computes signups, paid conversions, churn, MRR (+change), DAU/WAU/MAU,
// AI usage and credit revenue, and at-risk counts (failed payments,
// trials ending) for the rolling window, then renders branded HTML.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, escapeHtml, getAppOrigin } from "./email.server";

export type PulseWindow = "daily" | "weekly";

interface AtRiskRow {
  user_id: string;
  email: string;
  reason: string;
}

export interface PulseStats {
  window: PulseWindow;
  windowLabel: string;
  windowStart: string;
  windowEnd: string;
  signups: number;
  signupsPrev: number;
  paidConversions: number;
  churned: number;
  mrrCents: number;
  mrrChangeCents: number;
  payingCustomers: number;
  dau: number;
  wau: number;
  mau: number;
  aiActions: number;
  aiCreditRevenueCents: number;
  paymentFailed: AtRiskRow[];
  trialsEndingSoon: AtRiskRow[];
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSignedMoney(cents: number): string {
  if (cents === 0) return "no change";
  return `${cents > 0 ? "+" : ""}${fmtMoney(cents)}`;
}

function fmtSignedInt(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `${n}`;
}

async function emailForUser(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data.user?.email ?? "(unknown)";
}

export async function computePulse(window: PulseWindow): Promise<PulseStats> {
  const now = new Date();
  const days = window === "daily" ? 1 : 7;
  const end = now;
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const prevStart = new Date(start.getTime() - days * 24 * 3600 * 1000);
  const trialEndCutoff = new Date(end.getTime() + 3 * 24 * 3600 * 1000);

  // --- Signups (current + previous window)
  const [{ count: signups }, { count: signupsPrev }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", prevStart.toISOString())
      .lt("created_at", start.toISOString()),
  ]);

  // --- Subscription lifecycle events from analytics_events (cheap, indexed)
  const { data: lifecycle } = await supabaseAdmin
    .from("analytics_events")
    .select("type")
    .in("type", ["trial_converted", "subscription_canceled"])
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  const paidConversions = (lifecycle ?? []).filter((r) => r.type === "trial_converted").length;
  const churned = (lifecycle ?? []).filter((r) => r.type === "subscription_canceled").length;

  // --- MRR + paying customers (latest snapshots in window)
  const today = end.toISOString().slice(0, 10);
  const prevDay = new Date(end.getTime() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: snaps } = await supabaseAdmin
    .from("analytics_subscription_snapshots")
    .select("day, mrr_total_cents, pro_users, team_users")
    .in("day", [today, prevDay])
    .order("day", { ascending: false });
  const currentSnap = snaps?.find((s) => s.day === today) ?? snaps?.[0] ?? null;
  const previousSnap = snaps?.find((s) => s.day === prevDay) ?? null;
  const mrrCents = currentSnap?.mrr_total_cents ?? 0;
  const mrrChangeCents = mrrCents - (previousSnap?.mrr_total_cents ?? mrrCents);
  const payingCustomers = (currentSnap?.pro_users ?? 0) + (currentSnap?.team_users ?? 0);

  // --- DAU / WAU / MAU (latest analytics_daily_metrics row)
  const { data: metrics } = await supabaseAdmin
    .from("analytics_daily_metrics")
    .select("day, dau, wau, mau")
    .order("day", { ascending: false })
    .limit(1);
  const m = metrics?.[0];

  // --- AI actions in window (sum tokens count via analytics_events)
  const { count: aiActions } = await supabaseAdmin
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("type", "ai_action_used")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  // --- AI credit revenue in window (sum cost_cents from ai_usage rows with charge type)
  const { data: aiRev } = await supabaseAdmin
    .from("ai_usage")
    .select("cents")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  const aiCreditRevenueCents = (aiRev ?? []).reduce(
    (acc, r) => acc + (typeof r.cents === "number" ? r.cents : 0),
    0,
  );

  // --- At risk: payment failed in window
  const { data: failedRows } = await supabaseAdmin
    .from("analytics_events")
    .select("user_id, created_at")
    .eq("type", "payment_failed")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  const failedSeen = new Set<string>();
  const paymentFailed: AtRiskRow[] = [];
  for (const row of failedRows ?? []) {
    if (!row.user_id || failedSeen.has(row.user_id)) continue;
    failedSeen.add(row.user_id);
    paymentFailed.push({
      user_id: row.user_id,
      email: await emailForUser(row.user_id),
      reason: "Payment failed",
    });
  }

  // --- At risk: trials ending in <= 3 days
  const { data: trialRows } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, current_period_end")
    .eq("status", "trialing")
    .eq("environment", "live")
    .gt("current_period_end", end.toISOString())
    .lte("current_period_end", trialEndCutoff.toISOString())
    .order("current_period_end", { ascending: true })
    .limit(25);
  const trialsEndingSoon: AtRiskRow[] = [];
  for (const row of trialRows ?? []) {
    trialsEndingSoon.push({
      user_id: row.user_id,
      email: await emailForUser(row.user_id),
      reason: `Trial ends ${new Date(row.current_period_end!).toUTCString().slice(0, 16)}`,
    });
  }

  return {
    window,
    windowLabel: window === "daily" ? "Last 24 hours" : "Last 7 days",
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    signups: signups ?? 0,
    signupsPrev: signupsPrev ?? 0,
    paidConversions,
    churned,
    mrrCents,
    mrrChangeCents,
    payingCustomers,
    dau: m?.dau ?? 0,
    wau: m?.wau ?? 0,
    mau: m?.mau ?? 0,
    aiActions: aiActions ?? 0,
    aiCreditRevenueCents,
    paymentFailed,
    trialsEndingSoon,
  };
}

const cellHeader =
  'style="text-align:left;padding:8px 10px;font-family:Arial,sans-serif;font-size:12px;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #E7E2D6"';
const cellMetric =
  'style="padding:14px 10px;font-family:Georgia,serif;font-size:24px;color:#1F2A24;font-weight:600"';
const cellSub =
  'style="padding:0 10px 14px;font-family:Arial,sans-serif;font-size:13px;color:#7A7A7A"';

function statCell(label: string, value: string, sub: string): string {
  return `
    <td valign="top" width="33%" style="padding:6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5EFE3;border-radius:10px">
        <tr><td ${cellHeader}>${escapeHtml(label)}</td></tr>
        <tr><td ${cellMetric}>${escapeHtml(value)}</td></tr>
        <tr><td ${cellSub}>${escapeHtml(sub)}</td></tr>
      </table>
    </td>`;
}

function riskList(title: string, rows: AtRiskRow[], origin: string): string {
  if (!rows.length) {
    return `<p style="margin:6px 0 14px;font-family:Arial,sans-serif;color:#7A7A7A;font-size:13px">${escapeHtml(title)}: none</p>`;
  }
  const items = rows
    .map(
      (r) =>
        `<li style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;color:#3A3A3A"><a href="${origin}/admin/users/${r.user_id}" style="color:#5F6A56;text-decoration:none">${escapeHtml(r.email)}</a>, ${escapeHtml(r.reason)}</li>`,
    )
    .join("");
  return `
    <h3 style="margin:18px 0 6px;font-family:Georgia,serif;font-size:16px;color:#1F2A24">${escapeHtml(title)} (${rows.length})</h3>
    <ul style="margin:0 0 14px;padding:0 0 0 18px">${items}</ul>`;
}

export function renderPulseEmail(stats: PulseStats): { subject: string; html: string } {
  const origin = getAppOrigin();
  const subject =
    stats.window === "daily"
      ? `Platform Pulse, ${stats.signups} new, ${fmtMoney(stats.mrrCents)} MRR`
      : `Weekly Platform Pulse, ${stats.signups} new, ${fmtMoney(stats.mrrCents)} MRR`;

  const grid = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px">
      <tr>
        ${statCell("Signups", String(stats.signups), `${fmtSignedInt(stats.signups - stats.signupsPrev)} vs prior`)}
        ${statCell("New paid", String(stats.paidConversions), "Trial → paid")}
        ${statCell("Churn", String(stats.churned), "Cancellations")}
      </tr>
      <tr>
        ${statCell("MRR", fmtMoney(stats.mrrCents), `${fmtSignedMoney(stats.mrrChangeCents)} in window`)}
        ${statCell("Paying", String(stats.payingCustomers), "Pro + Team")}
        ${statCell("Active (DAU/WAU/MAU)", `${stats.dau} / ${stats.wau} / ${stats.mau}`, "Latest snapshot")}
      </tr>
      <tr>
        ${statCell("AI actions", stats.aiActions.toLocaleString("en-US"), "Logged in window")}
        ${statCell("AI revenue", fmtMoney(stats.aiCreditRevenueCents), "Credits consumed (cost-based)")}
        ${statCell("At risk", String(stats.paymentFailed.length + stats.trialsEndingSoon.length), "Failed pay + trials ending")}
      </tr>
    </table>`;

  const risk =
    riskList("Failed payments", stats.paymentFailed, origin) +
    riskList("Trials ending in ≤ 3 days", stats.trialsEndingSoon, origin);

  const html = brandedEmail({
    heading: stats.window === "daily" ? "Platform Pulse" : "Weekly Platform Pulse",
    preheader: `${stats.signups} signups, ${stats.paidConversions} conversions, ${fmtMoney(stats.mrrCents)} MRR.`,
    intro: `Here's the ${stats.window === "daily" ? "last 24 hours" : "last 7 days"} across Heartbeat.`,
    bodyHtml: grid + risk,
    ctaLabel: "Open Analytics",
    ctaUrl: `${origin}/admin/analytics`,
    ctaNoteHtml: `Window: ${escapeHtml(new Date(stats.windowStart).toUTCString())} → ${escapeHtml(new Date(stats.windowEnd).toUTCString())}`,
    footer: "You receive this because Platform Pulse is enabled for your super-admin account.",
  });

  return { subject, html };
}
