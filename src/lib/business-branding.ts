import { supabase } from "@/integrations/supabase/client";

export type StatusOption = { key: string; label: string; color: string };
export type PriorityOption = { key: string; label: string; color: string };

export type BrandingPatch = {
  name?: string;
  color?: string;
  logo_url?: string | null;
  task_statuses?: StatusOption[];
  priority_labels?: PriorityOption[];
};

export async function getBranding(businessId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, color, logo_url, task_statuses, priority_labels")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    color: data.color,
    logo_url: (data.logo_url as string | null) ?? null,
    task_statuses: (data.task_statuses as unknown as StatusOption[]) ?? [],
    priority_labels: (data.priority_labels as unknown as PriorityOption[]) ?? [],
  };
}

export async function saveBranding(businessId: string, patch: BrandingPatch) {
  const { error } = await supabase
    .from("businesses")
    .update(patch as never)
    .eq("id", businessId);
  if (error) throw error;
}

export async function uploadAccountLogo(businessId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${businessId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("account-logos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("account-logos").getPublicUrl(path);
  return data.publicUrl;
}
