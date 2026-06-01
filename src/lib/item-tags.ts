import { supabase } from "@/integrations/supabase/client";

export type ItemType = "task" | "note" | "event";

export type ItemTag = {
  id: string;
  item_type: ItemType;
  item_id: string;
  business_id: string;
  tagged_email: string;
  tagged_user_id: string | null;
  created_by: string | null;
  created_at: string;
};

export async function listTagsForItem(
  item_type: ItemType,
  item_id: string,
): Promise<ItemTag[]> {
  const { data, error } = await supabase
    .from("item_tags")
    .select("*")
    .eq("item_type", item_type)
    .eq("item_id", item_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ItemTag[];
}

export async function addTag(input: {
  item_type: ItemType;
  item_id: string;
  business_id: string;
  tagged_email: string;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const email = input.tagged_email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
  const { error } = await supabase.from("item_tags").insert({
    item_type: input.item_type,
    item_id: input.item_id,
    business_id: input.business_id,
    tagged_email: email,
    created_by: u.user.id,
  });
  if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw error;
}

export async function removeTag(tag_id: string) {
  const { error } = await supabase.from("item_tags").delete().eq("id", tag_id);
  if (error) throw error;
}
