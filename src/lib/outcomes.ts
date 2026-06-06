import { supabase } from "@/integrations/supabase/client";

export type OutcomeStatus = "active" | "achieved" | "archived";

export type Outcome = {
  id: string;
  owner_id: string;
  business_id: string | null;
  name: string;
  description: string | null;
  target_date: string | null;
  status: OutcomeStatus;
  created_at: string;
  updated_at: string;
};

export type OutcomeWithProgress = Outcome & {
  total_tasks: number;
  done_tasks: number;
  progress_pct: number;
};

export async function listOutcomes(businessId?: string | null): Promise<Outcome[]> {
  let q = supabase.from("outcomes").select("*").order("created_at", { ascending: false });
  if (businessId === null) q = q.is("business_id", null);
  else if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Outcome[];
}

export async function listOutcomesWithProgress(
  businessId?: string | null,
): Promise<OutcomeWithProgress[]> {
  const outcomes = await listOutcomes(businessId);
  if (outcomes.length === 0) return [];
  const ids = outcomes.map((o) => o.id);
  const { data, error } = await supabase
    .from("tasks")
    .select("outcome_id, status")
    .in("outcome_id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  const counts = new Map<string, { total: number; done: number }>();
  for (const t of data ?? []) {
    const oid = (t as { outcome_id: string }).outcome_id;
    const c = counts.get(oid) ?? { total: 0, done: 0 };
    c.total++;
    if ((t as { status: string }).status === "done") c.done++;
    counts.set(oid, c);
  }
  return outcomes.map((o) => {
    const c = counts.get(o.id) ?? { total: 0, done: 0 };
    return {
      ...o,
      total_tasks: c.total,
      done_tasks: c.done,
      progress_pct: c.total === 0 ? 0 : Math.round((c.done / c.total) * 100),
    };
  });
}

export async function createOutcome(input: {
  business_id: string | null;
  name: string;
  description?: string | null;
  target_date?: string | null;
}): Promise<{ id: string }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("outcomes")
    .insert({
      owner_id: u.user.id,
      business_id: input.business_id,
      name: input.name,
      description: input.description ?? null,
      target_date: input.target_date ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function updateOutcome(
  id: string,
  patch: Partial<Pick<Outcome, "name" | "description" | "target_date" | "status">>,
) {
  const { error } = await supabase.from("outcomes").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOutcome(id: string) {
  const { error } = await supabase.from("outcomes").delete().eq("id", id);
  if (error) throw error;
}

export async function listTasksForOutcome(outcomeId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, priority, due_at, business_id, list_id, outcome_id")
    .eq("outcome_id", outcomeId)
    .is("deleted_at", null)
    .order("status", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function daysRemaining(target: string | null): number | null {
  if (!target) return null;
  const t = new Date(`${target}T23:59:59`).getTime();
  const now = Date.now();
  return Math.ceil((t - now) / 86400000);
}
