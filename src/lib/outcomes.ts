import { supabase } from "@/integrations/supabase/client";

export type OutcomeStatus =
  | "not_started"
  | "in_progress"
  | "achieved"
  | "at_risk"
  | "archived"
  // Legacy value kept for backward compatibility; rendered as "In progress".
  | "active";

export type CanonicalOutcomeStatus = Exclude<OutcomeStatus, "not_started" | "active">;

export const OUTCOME_STATUS_OPTIONS: Array<{
  value: CanonicalOutcomeStatus;
  label: string;
}> = [
  { value: "in_progress", label: "In progress" },
  { value: "at_risk", label: "At risk" },
  { value: "achieved", label: "Done" },
  { value: "archived", label: "Archived" },
];

export const OUTCOME_STATUS_LABEL: Record<OutcomeStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  achieved: "Done",
  at_risk: "At risk",
  archived: "Archived",
  active: "In progress",
};

export function normaliseOutcomeStatus(s: OutcomeStatus): OutcomeStatus {
  return s === "active" ? "in_progress" : s;
}

export type Outcome = {
  id: string;
  owner_id: string;
  business_id: string | null;
  name: string;
  description: string | null;
  success_statement: string | null;
  metric_name: string | null;
  metric_target: number | null;
  metric_current: number | null;
  metric_unit: string | null;
  target_date: string | null;
  status: OutcomeStatus;
  created_at: string;
  updated_at: string;
};

export type OutcomeProgress = {
  total_tasks: number;
  done_tasks: number;
  in_progress_tasks: number;
  todo_tasks: number;
  progress_pct: number;
};

export type OutcomeWithProgress = Outcome & OutcomeProgress;

export async function listOutcomes(businessId?: string | null): Promise<Outcome[]> {
  let q = supabase.from("outcomes").select("*").order("created_at", { ascending: false });
  if (businessId === null) q = q.is("business_id", null);
  else if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Outcome[];
}

function rollup(rows: Array<{ status: string }>): OutcomeProgress {
  let done = 0;
  let inProg = 0;
  let todo = 0;
  for (const r of rows) {
    if (r.status === "done") done++;
    else if (r.status === "in_progress") inProg++;
    else todo++;
  }
  const total = rows.length;
  return {
    total_tasks: total,
    done_tasks: done,
    in_progress_tasks: inProg,
    todo_tasks: todo,
    progress_pct: total === 0 ? 0 : Math.round((done / total) * 100),
  };
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
  const groups = new Map<string, Array<{ status: string }>>();
  for (const t of data ?? []) {
    const oid = (t as { outcome_id: string }).outcome_id;
    const arr = groups.get(oid) ?? [];
    arr.push({ status: (t as { status: string }).status });
    groups.set(oid, arr);
  }
  return outcomes.map((o) => ({ ...o, ...rollup(groups.get(o.id) ?? []) }));
}

export async function getOutcomeWithProgress(id: string): Promise<OutcomeWithProgress | null> {
  const { data, error } = await supabase.from("outcomes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: rows, error: e2 } = await supabase
    .from("tasks")
    .select("status")
    .eq("outcome_id", id)
    .is("deleted_at", null);
  if (e2) throw e2;
  return { ...(data as Outcome), ...rollup(rows ?? []) };
}

export async function createOutcome(input: {
  business_id: string | null;
  name: string;
  description?: string | null;
  success_statement?: string | null;
  metric_name?: string | null;
  metric_target?: number | null;
  metric_current?: number | null;
  metric_unit?: string | null;
  target_date?: string | null;
  status?: OutcomeStatus;
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
      success_statement: input.success_statement ?? null,
      metric_name: input.metric_name ?? null,
      metric_target: input.metric_target ?? null,
      metric_current: input.metric_current ?? null,
      metric_unit: input.metric_unit ?? null,
      target_date: input.target_date ?? null,
      status: input.status ?? "not_started",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function updateOutcome(
  id: string,
  patch: Partial<
    Pick<
      Outcome,
      | "name"
      | "description"
      | "success_statement"
      | "metric_name"
      | "metric_target"
      | "metric_current"
      | "metric_unit"
      | "target_date"
      | "status"
    >
  >,
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
    .select("id, title, status, priority, due_at, business_id, list_id, outcome_id, assignee_id")
    .eq("outcome_id", outcomeId)
    .is("deleted_at", null)
    .order("status", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}


/**
 * Tasks that could be linked to this outcome — same account scope, not done,
 * not deleted, and not already linked to another outcome. RLS already
 * restricts results to tasks the user can see (owned or shared).
 */
export async function listLinkableTasksForOutcome(args: {
  outcomeId: string;
  businessId: string | null;
}) {
  let q = supabase
    .from("tasks")
    .select("id, title, status, business_id, outcome_id, due_at")
    .is("deleted_at", null)
    .is("outcome_id", null)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(100);
  // Match scope: an outcome belongs to a business (or Personal = null) and
  // its tasks should sit in the same scope.
  if (args.businessId) q = q.eq("business_id", args.businessId);
  else q = q.is("business_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function linkTaskToOutcome(taskId: string, outcomeId: string | null) {
  const { error } = await supabase
    .from("tasks")
    .update({ outcome_id: outcomeId })
    .eq("id", taskId);
  if (error) throw error;
}

export function daysRemaining(target: string | null): number | null {
  if (!target) return null;
  const t = new Date(`${target}T23:59:59`).getTime();
  const now = Date.now();
  return Math.ceil((t - now) / 86400000);
}
