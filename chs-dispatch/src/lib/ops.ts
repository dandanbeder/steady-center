// Thin wrappers over the database operations. Each checks the caller's role server-side
// and writes to the incident timeline in the same transaction.
import { supabase } from "./supabase";
import type { AssignmentStatus } from "@/domain/types";
import type { Incident } from "./db";
import { notifyChanged } from "./live";

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  notifyChanged();
  return data;
}

export const ops = {
  startCall: async (fields: Partial<Incident> = {}) => {
    const { data, error } = await supabase.from("incidents").insert(fields).select("id, call_id").single();
    if (error) throw new Error(error.message);
    notifyChanged();
    return data as { id: string; call_id: string };
  },
  updateIncident: async (id: string, patch: Partial<Incident>) => {
    const { error } = await supabase.from("incidents").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    notifyChanged();
  },
  issueAlert: (incident: string, channels: number[], title: string, body = "") =>
    rpc("issue_alert", { _incident: incident, _channels: channels, _title: title, _body: body }),
  handoverToDom: (incident: string, note: string) => rpc("handover_to_dom", { _incident: incident, _note: note }),
  offer: (incident: string, eta: number) => rpc("offer_to_attend", { _incident: incident, _eta: eta }),
  recordOffer: (incident: string, responder: string, eta: number) =>
    rpc("record_offer", { _incident: incident, _responder: responder, _eta: eta }),
  instruct: (incident: string, responder: string, status: Extract<AssignmentStatus, "go" | "stand_down">) =>
    rpc("set_instruction", { _incident: incident, _responder: responder, _status: status }),
  acknowledge: (incident: string) => rpc("acknowledge_instruction", { _incident: incident }),
  reassign: (from: string, to: string, responder: string, eta: number) =>
    rpc("reassign_responder", { _from: from, _to: to, _responder: responder, _eta: eta }),
  markTime: (incident: string, responder: string, what: "on_scene" | "cleared") =>
    rpc("mark_responder_time", { _incident: incident, _responder: responder, _what: what }),
  welfareCheck: (incident: string, responder: string, outcome: string) =>
    rpc("record_welfare_check", { _incident: incident, _responder: responder, _outcome: outcome }),
  note: (incident: string, body: string) => rpc("add_incident_note", { _incident: incident, _body: body }),
  close: (incident: string, cancelled = false) => rpc("close_incident", { _incident: incident, _cancelled: cancelled }),
  submitPcr: (pcr: string) => rpc("submit_pcr", { _pcr: pcr }),
  setOnCall: (on: boolean) => rpc("set_on_call", { _on: on }),
};
