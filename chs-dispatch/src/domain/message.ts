// Builds the single "Response Required" message (Manual p.12) from details the dispatcher
// already entered, or the private DOM handover for advice and Blackbox calls.

import { CATEGORY_BY_KEY, vitalRedFlags } from "./escalation";
import { normaliseW3W, threeQuestionsRed, w3wUrl, type Intake } from "./triage";
import { DOM_PATHWAYS, PATHWAY_LABEL, SPECIAL_CALL_LABEL, type Pathway } from "./types";

const yn = (v: boolean | null) => (v === null ? "Not asked" : v ? "Yes" : "No");

export function formatLocation(i: Pick<Intake, "street_address" | "apartment" | "suburb">): string {
  const street = i.apartment ? `${i.apartment}/${i.street_address}` : i.street_address;
  return [street, i.suburb].filter(Boolean).join(", ");
}

/** Best link for responders: what3words if given (precise to 3m), else a maps search. */
export function navigationUrl(i: Pick<Intake, "street_address" | "apartment" | "suburb" | "what3words" | "meeting_point">): string | null {
  const w = w3wUrl(i.what3words ?? "");
  if (w) return w;
  const q = [i.meeting_point, formatLocation(i)].filter(Boolean).join(", ");
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null;
}

export function buildResponseMessage(callId: string, i: Intake, pathway: Pathway): string {
  const isDom = DOM_PATHWAYS.includes(pathway);
  const lines: string[] = [];
  lines.push(isDom ? `DOM HANDOVER | ${callId}` : `RESPONSE REQUIRED | ${callId}`);
  lines.push(`PATHWAY: ${PATHWAY_LABEL[pathway]}`);
  if (i.special_call) lines.push(`SPECIAL CALL: ${SPECIAL_CALL_LABEL[i.special_call]}`);
  lines.push("");
  lines.push(`LOCATION: ${formatLocation(i) || "Unknown"}`);
  if (i.meeting_point) lines.push(`MEETING POINT: ${i.meeting_point}`);
  if (i.what3words && w3wUrl(i.what3words)) lines.push(`W3W: ///${normaliseW3W(i.what3words)}`);
  if (i.address_details) lines.push(`ACCESS: ${i.address_details}`);
  lines.push(`CROSS ST: ${i.cross_street || "Unknown"}`);
  lines.push(`PROBLEM: ${[i.main_problem || "Unknown", i.patient_age && `Age ${i.patient_age}`].filter(Boolean).join(" - ")}`);
  if (i.escalation_terms.length) lines.push(`ESCALATION: ${i.escalation_terms.map((k) => CATEGORY_BY_KEY[k]?.label ?? k).join("; ")}`);
  const flags = vitalRedFlags(i.vital_signs);
  if (flags.length) lines.push(`VITALS (RED FLAG): ${flags.join("; ")}`);
  if (i.emergency_complaint === false) {
    lines.push(
      `3 Qs: Alert/talking ${yn(i.alert_talking)}; Breathing normally ${yn(i.breathing_normally)}; Uncontrolled bleeding ${yn(i.uncontrolled_bleeding)}${threeQuestionsRed(i) ? " (RED FLAG)" : ""}`,
    );
  }
  if (isDom) {
    lines.push(`CALLER CONTACT: ${i.caller_contact || i.onscene_contact || "Not given"}`);
    if (pathway === "dom_direct") lines.push(`AMBULANCE NOTIFIED: ${i.ambulance_notified ? "Yes" : "No"}`);
    if (i.calling_from_community_org !== null)
      lines.push(`Community org: ${yn(i.calling_from_community_org)}; Worse in last 2 hrs: ${yn(i.worse_last_2h)}`);
  } else {
    lines.push(`ON-SCENE CONTACT: ${i.onscene_contact || i.caller_contact || "Not given"}`);
    lines.push(`Address confirmed?: ${i.address_confirmed ? "Yes" : "No"}`);
    lines.push(`AMBULANCE NOTIFIED: ${i.ambulance_notified ? "Yes" : "No"}`);
  }
  if (i.flags.includes("unsafe_situation")) lines.push("CAUTION: Unsafe situation reported. Do not enter until safe.");
  if (i.flags.includes("high_frequency_caller")) lines.push("Note: High frequency caller");
  if (i.flags.includes("not_from_hotline")) lines.push("Note: Not from the hotline");
  if (!isDom) {
    lines.push("");
    lines.push("Reply in the app with your ETA. An offer is not an assignment.");
  }
  return lines.join("\n");
}

/** Short critical-alert text for the Internal Messenger push. */
export function buildAlertTitle(callId: string, suburb: string, special: boolean): string {
  return `${special ? "SPECIAL CALL" : "CHS call"} ${callId}${suburb ? ` | ${suburb}` : ""}: check the job`;
}
