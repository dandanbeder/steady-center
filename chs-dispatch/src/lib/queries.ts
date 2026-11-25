import { supabase } from "./supabase";
import { must } from "./live";
import type { DispatchLog, Incident, IncidentAlert, IncidentEvent, IncidentResponder, PatientCareRecord, Profile } from "./db";

export type CrewRow = IncidentResponder & { profile: Profile };

export interface IncidentBundle {
  incident: Incident | null;
  alerts: IncidentAlert[];
  crew: CrewRow[];
  events: IncidentEvent[];
  log: DispatchLog | null;
  pcrs: PatientCareRecord[];
}

export const emptyBundle: IncidentBundle = { incident: null, alerts: [], crew: [], events: [], log: null, pcrs: [] };

let profileCache: Map<string, Profile> | null = null;
export async function profiles(force = false): Promise<Map<string, Profile>> {
  if (profileCache && !force) return profileCache;
  const rows = await must<Profile[]>(supabase.from("profiles").select("*"));
  profileCache = new Map(rows.map((p) => [p.id, p]));
  return profileCache;
}

async function withProfiles(rows: IncidentResponder[]): Promise<CrewRow[]> {
  let map = await profiles();
  if (rows.some((r) => !map.has(r.responder_id))) map = await profiles(true);
  return rows.filter((r) => map.has(r.responder_id)).map((r) => ({ ...r, profile: map.get(r.responder_id)! }));
}

export async function loadIncident(id: string, opts: { withCase: boolean }): Promise<IncidentBundle> {
  const [incident, alerts, crew, events] = await Promise.all([
    must<Incident | null>(supabase.from("incidents").select("*").eq("id", id).maybeSingle()),
    must<IncidentAlert[]>(supabase.from("incident_alerts").select("*").eq("incident_id", id).order("attempt")),
    must<IncidentResponder[]>(supabase.from("incident_responders").select("*").eq("incident_id", id).order("offered_at")),
    must<IncidentEvent[]>(supabase.from("incident_events").select("*").eq("incident_id", id).order("created_at")),
  ]);
  let log: DispatchLog | null = null;
  let pcrs: PatientCareRecord[] = [];
  if (opts.withCase) {
    [log, pcrs] = await Promise.all([
      must<DispatchLog | null>(supabase.from("dispatch_logs").select("*").eq("incident_id", id).maybeSingle()),
      must<PatientCareRecord[]>(supabase.from("patient_care_records").select("*").eq("incident_id", id)),
    ]);
  } else {
    pcrs = await must<PatientCareRecord[]>(supabase.from("patient_care_records").select("*").eq("incident_id", id));
  }
  return { incident, alerts, crew: await withProfiles(crew), events, log, pcrs };
}

export interface BoardIncident {
  incident: Incident;
  crew: CrewRow[];
  alerts: IncidentAlert[];
}

export async function loadOpenIncidents(): Promise<BoardIncident[]> {
  const incidents = await must<Incident[]>(
    supabase.from("incidents").select("*").not("status", "in", "(closed,cancelled)").order("received_at"),
  );
  if (!incidents.length) return [];
  const ids = incidents.map((i) => i.id);
  const [crew, alerts] = await Promise.all([
    must<IncidentResponder[]>(supabase.from("incident_responders").select("*").in("incident_id", ids)),
    must<IncidentAlert[]>(supabase.from("incident_alerts").select("*").in("incident_id", ids)),
  ]);
  const withP = await withProfiles(crew);
  return incidents.map((incident) => ({
    incident,
    crew: withP.filter((c) => c.incident_id === incident.id),
    alerts: alerts.filter((a) => a.incident_id === incident.id),
  }));
}

export async function loadClosedIncidents(limit = 100): Promise<(Incident & { log: DispatchLog | null; pcr_count: number })[]> {
  const incidents = await must<Incident[]>(
    supabase.from("incidents").select("*").in("status", ["closed", "cancelled"]).order("closed_at", { ascending: false }).limit(limit),
  );
  if (!incidents.length) return [];
  const ids = incidents.map((i) => i.id);
  const [logs, pcrs] = await Promise.all([
    must<DispatchLog[]>(supabase.from("dispatch_logs").select("*").in("incident_id", ids)),
    must<{ incident_id: string }[]>(supabase.from("patient_care_records").select("incident_id").in("incident_id", ids)),
  ]);
  return incidents.map((i) => ({
    ...i,
    log: logs.find((l) => l.incident_id === i.id) ?? null,
    pcr_count: pcrs.filter((p) => p.incident_id === i.id).length,
  }));
}
