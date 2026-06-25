import { supabase } from "@/integrations/supabase/client";

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  created_at: string;
  sort_order: number;
  archived_at: string | null;
  weekly_hours: number | null;
};

export async function listBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Business[];
}

export async function listAllBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Business[];
}

export async function createBusiness(name: string, color: string): Promise<{ id: string }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  // Place new account at the bottom of the user's list
  const { data: rows } = await supabase
    .from("businesses")
    .select("sort_order")
    .eq("owner_id", u.user.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (rows && rows[0]?.sort_order ? Number(rows[0].sort_order) : 0) + 1;
  const { data, error } = await supabase
    .from("businesses")
    .insert({ name, color, owner_id: u.user.id, sort_order: nextOrder })
    .select("id")
    .single();
  if (error) {
    // DB trigger raises UPGRADE_REQUIRED when the plan cap is hit. We surface
    // a calm, plan-agnostic nudge — the upgrade affordance lives in the UI
    // (CreateAccountDialog catches this and offers a link to /billing).
    if (/UPGRADE_REQUIRED/i.test(error.message)) {
      throw new Error("You've reached your plan's accounts — upgrade to add more.");
    }
    throw error;
  }
  return { id: data.id };
}

export async function updateBusiness(
  id: string,
  patch: Partial<Pick<Business, "name" | "color">>,
) {
  const { error } = await supabase.from("businesses").update(patch).eq("id", id);
  if (error) throw error;
}

export async function archiveBusiness(id: string) {
  const { error } = await supabase
    .from("businesses")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function unarchiveBusiness(id: string) {
  const { error } = await supabase
    .from("businesses")
    .update({ archived_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function reorderBusinesses(orderedIds: string[]) {
  // Sequentially update; rely on RLS (only owner/member can update)
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from("businesses").update({ sort_order: idx + 1 } as never).eq("id", id),
    ),
  );
}

export async function deleteBusiness(id: string) {
  const { error } = await supabase.from("businesses").delete().eq("id", id);
  if (error) throw error;
}

/** Re-map a calendar to a different Account (or to none). */
export async function setCalendarBusiness(calendarId: string, businessId: string | null) {
  const { error } = await supabase
    .from("calendars")
    .update({ business_id: businessId } as never)
    .eq("id", calendarId);
  if (error) throw error;
}
