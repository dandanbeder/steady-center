import { supabase } from "@/integrations/supabase/client";

export type TemplateKind = "note" | "task";
export type Template = {
  id: string;
  business_id: string;
  kind: TemplateKind;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export async function listTemplates(businessId: string): Promise<Template[]> {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("business_id", businessId)
    .order("kind")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Template[];
}

export async function createTemplate(input: {
  business_id: string;
  kind: TemplateKind;
  name: string;
  body: string;
}) {
  const { error } = await supabase.from("templates").insert(input);
  if (error) throw error;
}

export async function updateTemplate(id: string, patch: Partial<Pick<Template, "name" | "body" | "kind">>) {
  const { error } = await supabase.from("templates").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw error;
}
