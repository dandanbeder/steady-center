import { supabase } from "@/integrations/supabase/client";

export type OnboardingProfile = {
  onboarding_completed_at: string | null;
  weekly_review_day: number;
  weekly_review_hour: number;
  weekly_review_enabled: boolean;
  timezone: string;
  full_name: string | null;
};

export async function getOnboardingProfile(): Promise<OnboardingProfile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed_at, weekly_review_day, weekly_review_hour, weekly_review_enabled, timezone, full_name",
    )
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as OnboardingProfile) ?? null;
}


export async function saveWeeklyReview(p: {
  day: number;
  hour: number;
  enabled: boolean;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({
      weekly_review_day: p.day,
      weekly_review_hour: p.hour,
      weekly_review_enabled: p.enabled,
    })
    .eq("id", u.user.id);
  if (error) throw error;
}

export async function completeOnboarding() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", u.user.id);
  if (error) throw error;
}

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Johannesburg";
  } catch {
    return "Africa/Johannesburg";
  }
}
