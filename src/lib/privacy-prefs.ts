import { supabase } from "@/integrations/supabase/client";

export type PrivacyPrefs = {
  marketing_opt_in: boolean;
  ai_optional_disabled: boolean;
};

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  marketing_opt_in: false,
  ai_optional_disabled: false,
};

export async function getPrivacyPrefs(): Promise<PrivacyPrefs> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return DEFAULT_PRIVACY_PREFS;
  const { data } = await supabase
    .from("profiles")
    .select("marketing_opt_in, ai_optional_disabled")
    .eq("id", u.user.id)
    .maybeSingle();
  return {
    marketing_opt_in: !!data?.marketing_opt_in,
    ai_optional_disabled: !!(data as { ai_optional_disabled?: boolean } | null)
      ?.ai_optional_disabled,
  };
}

export async function savePrivacyPrefs(patch: Partial<PrivacyPrefs>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update(patch as never)
    .eq("id", u.user.id);
  if (error) throw error;
}
