// Shared (client + server) entitlement logic. No imports — keep this pure.
export type Tier = "free" | "pro" | "team";

export type Feature =
  | "meetings"
  | "ai_assistant"
  | "weekly_reports"
  | "daily_pulse"
  | "unlimited_businesses"
  | "invite_members"
  | "shared_inbox";

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  meetings: "pro",
  ai_assistant: "pro",
  weekly_reports: "pro",
  daily_pulse: "pro",
  unlimited_businesses: "pro",
  invite_members: "team",
  shared_inbox: "team",
};

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, team: 2 };

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

export function requiredTierFor(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export const FREE_BUSINESS_LIMIT = 1;

export const UPGRADE_REQUIRED_PREFIX = "UPGRADE_REQUIRED:";

export function tierLabel(tier: Tier): string {
  return tier === "team" ? "Team" : tier === "pro" ? "Pro" : "Free";
}
