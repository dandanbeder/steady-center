import { supabase } from "@/integrations/supabase/client";

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  created_at: string;
};

export async function listBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createBusiness(name: string, color: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("businesses")
    .insert({ name, color, owner_id: u.user.id });
  if (error) throw error;
}

export async function updateBusiness(id: string, patch: Partial<Pick<Business, "name" | "color">>) {
  const { error } = await supabase.from("businesses").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteBusiness(id: string) {
  const { error } = await supabase.from("businesses").delete().eq("id", id);
  if (error) throw error;
}
