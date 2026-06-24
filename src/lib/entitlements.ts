// Shared (client + server) entitlement logic. No imports, keep this pure.
//
// Heartbeat plans (4 tiers). "Space" is the user's ONE calm home. "Account"
// is a business / area organised WITHIN that space — the countable thing
// plans limit. Team adds shared spaces on top.
export type Tier = "free" | "basic" | "pro" | "team";
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
  | "team_sharing"
  | "ask_my_notes";

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  // Reporting & meetings unlock on Basic (and above).
  meetings: "basic",
  weekly_reports: "basic",
  daily_pulse: "basic",
  // Ask my notes (full) and the AI assistant unlock on Standard (pro).
  ai_assistant: "pro",
  ask_my_notes: "pro",
  // More than one account requires at least Basic.
  unlimited_businesses: "basic",
  // Team-only.
  invite_members: "team",
  shared_inbox: "team",
  team_sharing: "team",
};

const TIER_RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2, team: 3 };

export type PlanLimits = {
  /** Accounts (businesses/areas) the user can organise within their space. -1 = unlimited. */
  maxBusinesses: number;
  maxCalendarConnections: number;
  /** Per paid seat. Team pools across paid seats; Free/Basic/Standard use a single seat. */
  aiAllowanceCreditsPerSeat: number;
  /** Whether the account can buy AI credit top-ups. */
  canTopup: boolean;
  /** Granular sharing (shares table, account-scope grants). Team-only. */
  sharingEnabled: boolean;
  /** Team-only surfaces (Team & Access page, member management, shared inbox). */
  teamFeaturesEnabled: boolean;
};

/**
 * SINGLE SOURCE OF TRUTH for per-plan limits. Mirrored on the DB side by
 * `public.plan_limits(uuid)`. Every "is this account allowed to X?" check
 * reads from here, via effectiveLimits() (client/shared) or
 * getAccountEntitlements() (server, with status + seat_count + cycle merged
 * in). Do not hardcode plan rules anywhere else.
 */
export const LIMITS: Record<Tier, PlanLimits> = {
  free: {
    maxBusinesses: 1,
    maxCalendarConnections: 1,
    aiAllowanceCreditsPerSeat: 25,
    canTopup: true,
    sharingEnabled: false,
    teamFeaturesEnabled: false,
  },
  basic: {
    maxBusinesses: 2,
    maxCalendarConnections: -1,
    aiAllowanceCreditsPerSeat: 300,
    canTopup: true,
    sharingEnabled: false,
    teamFeaturesEnabled: false,
  },
  pro: {
    maxBusinesses: 4,
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

/** Display label for a tier — note `pro` is presented to users as "Standard". */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case "team":
      return "Team";
    case "pro":
      return "Standard";
    case "basic":
      return "Basic";
    default:
      return "Free";
  }
}

// Pricing constants (USD cents). Source of truth for UI; Paddle owns the actual charge.
// Annual prices reflect the per-month equivalent advertised on the pricing page:
//   Basic    $9/mo  · $7.38/mo billed annually  ($88.56/yr)
//   Standard $10/mo · $8.20/mo billed annually  ($98.40/yr)
//   Team     $15/seat/mo · $12.30/seat billed annually ($147.60/seat/yr)
export const PRICING = {
  basic_monthly: { amount: 900,  cycle: "month" as BillingCycle, priceId: "basic_monthly" },
  basic_yearly:  { amount: 8856, cycle: "year"  as BillingCycle, priceId: "basic_yearly"  },
  pro_monthly:   { amount: 1000, cycle: "month" as BillingCycle, priceId: "pro_monthly"   },
  pro_yearly:    { amount: 9840, cycle: "year"  as BillingCycle, priceId: "pro_yearly"    },
  team_monthly:  { amount: 1500, cycle: "month" as BillingCycle, priceId: "team_monthly"  },
  team_yearly:   { amount: 14760, cycle: "year" as BillingCycle, priceId: "team_yearly"   },
};

/** Minimum seats for Team plan (matches Paddle quantity.minimum). */
export const TEAM_MIN_SEATS = 2;
/** Trial length in days for new Pro/Team trials started from pricing page. */
export const TRIAL_DAYS = 7;

export const FREE_BUSINESS_LIMIT = LIMITS.free.maxBusinesses;

/** Shared helper copy that appears anywhere we talk about the space/account model. */
export const SPACE_ACCOUNT_HELPER =
  "Your space is your calm home. Accounts keep your different businesses or areas organised within it — and Team adds shared spaces to work together.";
