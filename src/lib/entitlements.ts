// Shared (client + server) entitlement logic. No imports, keep this pure.
export type Tier = "free" | "pro" | "team";
export type BillingCycle = "month" | "year";

export const PAID_SEAT_ROLES = ["owner", "admin", "member"] as const;
export const FREE_ROLES = ["viewer", "commenter"] as const;
export type PaidRole = (typeof PAID_SEAT_ROLES)[number];
export type FreeRole = (typeof FREE_ROLES)[number];

export function isPaidRole(role: string | null | undefined): boolean {
  return !!role && (PAID_SEAT_ROLES as readonly string[]).includes(role);
}

export type Feature =
  | "meetings"
  | "ai_assistant"
  | "weekly_reports"
  | "daily_pulse"
  | "unlimited_businesses"
  | "invite_members"
  | "shared_inbox"
  | "team_sharing";

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  meetings: "pro",
  ai_assistant: "pro",
  weekly_reports: "pro",
  daily_pulse: "pro",
  unlimited_businesses: "pro",
  invite_members: "team",
  shared_inbox: "team",
  team_sharing: "team",
};

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, team: 2 };

export type PlanLimits = {
  // -1 = unlimited
  maxBusinesses: number;
  maxCalendarConnections: number;
  /** Per paid seat. Team pools across paid seats; Free/Pro use a single seat. */
  aiAllowanceCreditsPerSeat: number;
  /** Whether the account can buy AI credit top-ups. */
  canTopup: boolean;
  /** Granular sharing (shares table, account-scope grants). Team-only. */
  sharingEnabled: boolean;
  /** Team-only surfaces (Team & Access page, member management, shared inbox). */
  teamFeaturesEnabled: boolean;
};

/**
 * SINGLE SOURCE OF TRUTH for per-plan limits.
 * Every "is this account allowed to X?" check reads from here, via
 * effectiveLimits() (client/shared) or getAccountEntitlements() (server, with
 * status + seat_count + cycle merged in). Do not hardcode plan rules anywhere else.
 */
export const LIMITS: Record<Tier, PlanLimits> = {
  free: {
    maxBusinesses: 1,
    maxCalendarConnections: 1,
    aiAllowanceCreditsPerSeat: 20,
    canTopup: true,
    sharingEnabled: false,
    teamFeaturesEnabled: false,
  },
  pro: {
    maxBusinesses: -1,
    maxCalendarConnections: -1,
    aiAllowanceCreditsPerSeat: 400,
    canTopup: true,
    sharingEnabled: false,
    teamFeaturesEnabled: false,
  },
  team: {
    maxBusinesses: -1,
    maxCalendarConnections: -1,
    aiAllowanceCreditsPerSeat: 400,
    canTopup: true,
    sharingEnabled: true,
    teamFeaturesEnabled: true,
  },
};

// Back-compat aliases for existing call sites. New code should read PlanLimits fields directly.
export type LegacyPlanLimits = PlanLimits & {
  accounts: number;
  calendarConnections: number;
  aiActionsPerSeat: number;
  teamSharing: boolean;
};

function withLegacy(p: PlanLimits): LegacyPlanLimits {
  return {
    ...p,
    accounts: p.maxBusinesses,
    calendarConnections: p.maxCalendarConnections,
    aiActionsPerSeat: p.aiAllowanceCreditsPerSeat,
    teamSharing: p.sharingEnabled,
  };
}

/** Effective per-account limits given tier + paid-seat count (Team pools AI per paid seat). */
export function effectiveLimits(
  tier: Tier,
  paidSeats = 1,
): LegacyPlanLimits & { aiActionsCap: number; aiAllowanceCredits: number } {
  const base = LIMITS[tier];
  const seats = tier === "team" ? Math.max(paidSeats, 2) : 1;
  const aiAllowanceCredits = base.aiAllowanceCreditsPerSeat * seats;
  return { ...withLegacy(base), aiActionsCap: aiAllowanceCredits, aiAllowanceCredits };
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

export function requiredTierFor(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export const UPGRADE_REQUIRED_PREFIX = "UPGRADE_REQUIRED:";
export const SEAT_LIMIT_PREFIX = "SEAT_LIMIT_REACHED:";

export function tierLabel(tier: Tier): string {
  return tier === "team" ? "Team" : tier === "pro" ? "Pro" : "Free";
}

// Pricing constants (USD cents). Source of truth for UI; Paddle owns the actual charge.
export const PRICING = {
  pro_monthly: { amount: 1000, cycle: "month" as BillingCycle, priceId: "pro_monthly" },
  pro_yearly: { amount: 9600, cycle: "year" as BillingCycle, priceId: "pro_yearly" },
  team_monthly: { amount: 1200, cycle: "month" as BillingCycle, priceId: "team_monthly" },
  team_yearly: { amount: 12000, cycle: "year" as BillingCycle, priceId: "team_yearly" },
};

export const FREE_BUSINESS_LIMIT = LIMITS.free.accounts;
