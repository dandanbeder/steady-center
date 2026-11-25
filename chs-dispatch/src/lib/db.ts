// Row shapes for the tables in supabase/migrations.
import type { AssignmentStatus, CallSource, CoverageStatus, Hotline, IncidentStatus, Pathway, Rank, Role, SpecialCall } from "@/domain/types";
import type { IncidentFlag } from "@/domain/types";
import type { EscalationCategory, VitalSigns } from "@/domain/escalation";

export interface Profile {
  id: string;
  full_name: string;
  call_sign: string | null;
  rank: Rank | null;
  is_ert: boolean;
  has_kit: boolean;
  has_radio: boolean;
  on_call: boolean;
  phone: string | null;
}

export interface Incident {
  id: string;
  call_id: string;
  status: IncidentStatus;
  call_source: CallSource;
  hotline: Hotline;
  street_address: string;
  apartment: string;
  address_details: string;
  suburb: string;
  cross_street: string;
  in_area: boolean;
  meeting_point: string;
  what3words: string;
  main_problem: string;
  escalation_terms: EscalationCategory[];
  vital_signs: VitalSigns;
  blackbox: boolean;
  dom_approved_at: string | null;
  dom_approval_note: string;
  sitrep_at: string | null;
  sitrep_acuity: "routine" | "emergency" | null;
  duress_at: string | null;
  emergency_complaint: boolean | null;
  alert_talking: boolean | null;
  breathing_normally: boolean | null;
  uncontrolled_bleeding: boolean | null;
  calling_from_community_org: boolean | null;
  worse_last_2h: boolean | null;
  patient_age: string;
  caller_contact: string;
  onscene_contact: string;
  address_confirmed: boolean;
  ambulance_notified: boolean;
  special_call: SpecialCall | null;
  flags: IncidentFlag[];
  suggested_pathway: Pathway | null;
  pathway: Pathway | null;
  pathway_override_reason: string | null;
  response_message: string | null;
  coverage: CoverageStatus;
  dispatcher_id: string | null;
  received_at: string;
  dispatched_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

export interface IncidentAlert {
  id: string;
  incident_id: string;
  attempt: number;
  channel_ids: number[];
  title: string;
  body: string;
  sent_at: string;
}

export interface IncidentResponder {
  id: string;
  incident_id: string;
  responder_id: string;
  status: AssignmentStatus;
  offered_at: string;
  eta_minutes: number | null;
  eta_from: string;
  instruction_at: string | null;
  acknowledged_status: AssignmentStatus | null;
  acknowledged_at: string | null;
  on_air_at: string | null;
  on_scene_at: string | null;
  cleared_at: string | null;
  last_welfare_check_at: string | null;
  reassigned_to: string | null;
  reassigned_from: string | null;
}

export interface IncidentEvent {
  id: number;
  incident_id: string;
  kind: string;
  actor_id: string | null;
  responder_id: string | null;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface DispatchLog {
  incident_id: string;
  call_type: "proceeded" | "cancelled" | "incorrect_extension" | "wrong_number" | "chs_notified" | "dom_or_responder_direct";
  cancellation_reason: string;
  sitrep: string;
  ambulance_called_at: string | null;
  ambulance_arrived_at: string | null;
  patient_outcome: string;
  dom_notes: string;
  final_notes: string;
  completed_by: string | null;
  completed_at: string | null;
}

export interface PatientCareRecord {
  id: string;
  incident_id: string;
  responder_id: string;
  patient_age: string;
  presenting_complaint: string;
  observations: string;
  treatment: string;
  disposition: string;
  handed_to_ambulance: boolean;
  submitted_at: string | null;
  created_at: string;
}

export interface ChannelMembership {
  user_id: string;
  channel_id: number;
  online: boolean;
}

export type { Role };
