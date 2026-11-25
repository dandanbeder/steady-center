import { recommend, type AllocationResult, type Candidate } from "@/domain/allocation";
import type { Incident } from "@/lib/db";
import type { CrewRow } from "@/lib/queries";

export function toCandidates(crew: CrewRow[]): Candidate[] {
  return crew
    .filter((c) => c.profile.rank)
    .map((c) => ({
      responder_id: c.responder_id,
      call_sign: c.profile.call_sign ?? "?",
      rank: c.profile.rank!,
      is_ert: c.profile.is_ert,
      has_kit: c.profile.has_kit,
      on_call: c.profile.on_call,
      eta_minutes: c.eta_minutes,
      status: c.status,
    }));
}

export function allocationFor(incident: Incident, crew: CrewRow[]): AllocationResult {
  return recommend({
    pathway: incident.pathway,
    special_call: incident.special_call,
    at: new Date(incident.received_at),
    candidates: toCandidates(crew),
  });
}

export function crewGroups(crew: CrewRow[]) {
  return {
    going: crew.filter((c) => c.status === "go"),
    offered: crew.filter((c) => c.status === "offered"),
    stoodDown: crew.filter((c) => c.status === "stand_down"),
    movedOut: crew.filter((c) => c.status === "reassigned"),
    cleared: crew.filter((c) => c.status === "cleared"),
  };
}

/** Instruction given but the responder hasn't echoed it back yet. */
export const awaitingAck = (c: CrewRow) =>
  (c.status === "go" || c.status === "stand_down") && c.acknowledged_status !== c.status;
