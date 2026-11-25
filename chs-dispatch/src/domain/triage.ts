// Encodes the CHS dispatch flowchart (updated 19/08/2025), the Dispatcher Manual (May 2025)
// and the Escalation / Emergency Terms matrix (July 2025 draft).
// The engine only *suggests*. The dispatcher chooses the pathway; an override is recorded.
//
// Outcomes (Manual p.6):
//   Emergency line: no escalation → responders (Yellow); escalation → responders + 112 (Red)
//   Advice line:    no escalation → hand over to the DOM (Green); escalation → Red
// Exceptions (Manual p.8, matrix):
//   * Advice line: burns, severe pain and vital-sign advice (unless red-flag numbers) stay advice.
//   * Assault, aggression, self-harm, suicide, drug related ("Blackbox"): connect to 112 and hand
//     to the DOM; no responders until the DOM approves.
//   * Out of the coverage area: transfer to 112 regardless of severity, and dispatch as normal.
//   * High-frequency caller on the emergency line: the DOM calls them back to triage.

import { isAdviceOvernight } from "./time";
import { CATEGORY_BY_KEY, vitalRedFlags, type EscalationCategory, type VitalSigns } from "./escalation";
import type { CallSource, Hotline, IncidentFlag, Pathway, SpecialCall } from "./types";

export interface Intake {
  call_source: CallSource;
  hotline: Hotline;
  street_address: string;
  apartment: string;
  address_details: string;
  suburb: string;
  cross_street: string;
  in_area: boolean;
  /** When there's no street address: the agreed accessible meeting point (Manual p.25). */
  meeting_point: string;
  /** what3words address, e.g. "filled.count.soap", used when a location is hard to describe. */
  what3words: string;
  /** Precise point from Google Places, a dragged pin, or what3words. */
  latitude: number | null;
  longitude: number | null;
  location_source: "" | "address" | "pin" | "what3words";
  main_problem: string;
  /** Escalation matrix categories the dispatcher has confirmed apply. */
  escalation_terms: EscalationCategory[];
  vital_signs: VitalSigns;
  /** "Are there any 'Emergency Complaints' immediately identified?" */
  emergency_complaint: boolean | null;
  // The three questions
  alert_talking: boolean | null;
  breathing_normally: boolean | null;
  uncontrolled_bleeding: boolean | null;
  // Advice line, Health Direct branch (May 2025 manual only; see TriageOptions)
  calling_from_community_org: boolean | null;
  worse_last_2h: boolean | null;
  patient_age: string;
  caller_contact: string;
  onscene_contact: string;
  address_confirmed: boolean;
  ambulance_notified: boolean;
  special_call: SpecialCall | null;
  flags: IncidentFlag[];
}

export const emptyIntake = (): Intake => ({
  call_source: "hotline",
  hotline: "emergency",
  street_address: "",
  apartment: "",
  address_details: "",
  suburb: "",
  cross_street: "",
  in_area: true,
  meeting_point: "",
  what3words: "",
  latitude: null,
  longitude: null,
  location_source: "",
  main_problem: "",
  escalation_terms: [],
  vital_signs: {},
  emergency_complaint: null,
  alert_talking: null,
  breathing_normally: null,
  uncontrolled_bleeding: null,
  calling_from_community_org: null,
  worse_last_2h: null,
  patient_age: "",
  caller_contact: "",
  onscene_contact: "",
  address_confirmed: false,
  ambulance_notified: false,
  special_call: null,
  flags: [],
});

/** The caller's answers held on an incident record. */
export function intakeFrom<T extends Intake>(row: T): Intake {
  const keys = Object.keys(emptyIntake()) as (keyof Intake)[];
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? emptyIntake()[k]])) as unknown as Intake;
}

export interface TriageOptions {
  /**
   * The May 2025 manual routes low-risk advice calls to Health Direct (Purple) overnight, and
   * in hours unless calling from a community organisation or worse in the last 2 hours.
   * The 19/08/2025 flowchart sends every non-escalated advice call to the DOM (Script 3).
   * Off by default: the newer flowchart wins.
   */
  adviceHealthDirect?: boolean;
}

export type ScriptNo = 1 | 2 | 3 | 4;

export interface Script {
  no: ScriptNo;
  title: string;
  /** Read to the caller (Manual p.11). */
  say: string;
  /** What the dispatcher does, in order. */
  actions: string[];
}

export const SCRIPTS: Record<ScriptNo, Script> = {
  1: {
    no: 1,
    title: "Script 1: Emergency, 112 & Responders",
    say: "I have CHS Responders on their way to assist you now. Please ensure someone is waiting at the door / outside. I am now going to add 000 into this call. When it is connected, ask for an ambulance, and explain the situation from the beginning. I'm adding them in now.",
    actions: ["Add 112 to the call (Dialpad). Do not hang up; mute yourself", "Dispatch CHS responders", "Send Internal Messenger alert"],
  },
  2: {
    no: 2,
    title: "Script 2: Responders only",
    say: "I have CHS Responders on their way to assist you now and they will be with you shortly. Please ensure someone is waiting at the door / outside. Okay, we'll be with you soon. Please call back if anything changes in the meantime.",
    actions: ["Dispatch CHS responders", "Send Internal Messenger alert"],
  },
  3: {
    no: 3,
    title: "Script 3: Advice (DOM)",
    say: "Based on the information you have provided, speaking with a CHS Duty Operations Manager would be the most appropriate option for you. They will call you back shortly to discuss further. Please stay by your phone and if anything changes in the interim, please call back straight away.",
    actions: [
      "Send the message directly to the DOM (not the response group)",
      "Hang up. Call the DOM on 1300 247 679, press 0, and hand over",
      "Post \"advice call with DOM\" in the dispatcher group",
    ],
  },
  4: {
    no: 4,
    title: "Script 4: Health Direct",
    say: "Based on the information you have provided, speaking to a healthcare worker from Health Direct would be the most appropriate option for you. They will ask you a more in-depth stream of questions and you will need to explain the situation from the beginning. Would you be happy for me to connect you? … OK, I am connecting you now. If the call drops out please ring back and press three.",
    actions: ["Confirm the caller is happy to be transferred", "Transfer to Health Direct"],
  },
};

/** Blackbox: Red, but responders only with the DOM's approval. */
export const BLACKBOX_SCRIPT = {
  title: "Blackbox: 112 and DOM, no responders yet",
  actions: [
    "Add 112 to the call (Dialpad). Do not hang up; mute yourself",
    "Hand over to the DOM (1300 247 679, press 0)",
    "Do not send responders until the DOM approves",
  ],
};

/** Coverage-area exception (Manual p.25). */
export const OUT_OF_AREA_SAY =
  "We do not have a large responder base in that area, but we will transfer you to 000 and try and organise help from our nearest responders.";

export const PATHWAY_SCRIPT: Partial<Record<Pathway, ScriptNo>> = {
  red_in_area: 1,
  red_out_of_area: 1,
  yellow: 2,
  green: 3,
  purple: 4,
};

export type QuestionKey =
  | "address"
  | "main_problem"
  | "emergency_complaint"
  | "three_questions"
  | "community_org"
  | "worse_last_2h"
  | "onscene_contact"
  | "confirm_address"
  | "patient_age";

export interface TriageResult {
  /** Questions the dispatcher should ask, in flowchart order. */
  questions: QuestionKey[];
  complete: boolean;
  suggested: Pathway | null;
  script: Script | null;
  /** Red pathway that needs the DOM's approval before responders go. */
  blackbox: boolean;
  /** 112 should be added to the call. */
  add112: boolean;
  /** Why the engine suggests this, phrased for the dispatcher. */
  reasons: string[];
}

/** Any of the three questions answered in the "red" direction. */
export function threeQuestionsRed(i: Intake): boolean {
  return i.alert_talking === false || i.breathing_normally === false || i.uncontrolled_bleeding === true;
}

function threeQuestionsAnswered(i: Intake): boolean {
  return i.alert_talking !== null && i.breathing_normally !== null && i.uncontrolled_bleeding !== null;
}

export function isBlackbox(i: Intake): boolean {
  return i.flags.includes("unsafe_situation") || i.escalation_terms.some((k) => CATEGORY_BY_KEY[k]?.blackbox);
}

/**
 * Advice line only: are the confirmed emergency complaints all advice exceptions
 * (burns, severe pain, vital-sign advice without red-flag numbers)?
 */
export function onlyAdviceExceptions(i: Intake): boolean {
  if (!i.escalation_terms.length) return false;
  if (vitalRedFlags(i.vital_signs).length) return false;
  return i.escalation_terms.every((k) => CATEGORY_BY_KEY[k]?.adviceException);
}

export function triage(i: Intake, at: Date = new Date(), opts: TriageOptions = {}): TriageResult {
  const q: QuestionKey[] = ["address", "main_problem", "emergency_complaint"];
  const reasons: string[] = [];
  let blackbox = false;
  const done = (suggested: Pathway | null, complete = true): TriageResult => {
    const scriptNo = suggested ? PATHWAY_SCRIPT[suggested] : undefined;
    return {
      questions: q,
      complete,
      suggested,
      script: scriptNo ? SCRIPTS[scriptNo] : null,
      blackbox,
      add112: suggested === "red_in_area" || suggested === "red_out_of_area" || blackbox,
      reasons,
    };
  };
  const finalQs = () => q.push("onscene_contact", "confirm_address", "patient_age");

  if (i.call_source === "dom_direct") {
    reasons.push("Incident raised directly by the DOM.");
    return done("dom_direct");
  }

  const redFlags = vitalRedFlags(i.vital_signs);
  if (redFlags.length) reasons.push(`Red-flag vital signs: ${redFlags.join("; ")}.`);

  // Responder pathways become Red (out of area) outside the coverage area: always add 112.
  const responders = (p: "red_in_area" | "yellow"): TriageResult => {
    finalQs();
    if (!i.in_area) {
      reasons.push("Outside the CHS coverage area: transfer to 112 regardless of severity and dispatch the nearest responders.");
      return done("red_out_of_area");
    }
    return done(p);
  };

  if (isBlackbox(i)) {
    blackbox = true;
    finalQs();
    reasons.push("Assault, aggression, self-harm, suicide or drug related: connect to 112 and hand over to the DOM. No responders until the DOM approves.");
    return done("dom_direct");
  }

  let escalated: boolean | null = i.emergency_complaint;
  if (redFlags.length) escalated = true;
  if (escalated === null) return done(null, false);

  if (escalated && i.hotline === "advice" && onlyAdviceExceptions(i)) {
    reasons.push("Advice line: burns, severe pain and vital-sign advice stay as advice unless other criteria are met.");
    escalated = false;
  }

  if (escalated) {
    reasons.push("Emergency Complaint identified.");
    if (i.flags.includes("high_frequency_caller")) reasons.push("High-frequency caller: also notify the DOM.");
    return responders("red_in_area");
  }

  reasons.push("No initial emergency indications.");
  q.push("three_questions");
  if (!threeQuestionsAnswered(i)) return done(null, false);

  if (threeQuestionsRed(i)) {
    if (i.alert_talking === false) reasons.push("Patient is not alert and talking appropriately.");
    if (i.breathing_normally === false) reasons.push("Patient is not breathing normally.");
    if (i.uncontrolled_bleeding === true) reasons.push("Uncontrolled bleeding.");
    if (i.hotline === "advice") reasons.push("Advice call meeting escalation criteria becomes Red.");
    return responders("red_in_area");
  }
  reasons.push("Alert and talking, breathing normally, no uncontrolled bleeding.");

  if (i.hotline !== "advice") {
    if (i.flags.includes("high_frequency_caller")) {
      reasons.push("High-frequency caller on the emergency line: tell them a DOM will call to triage (advice procedure).");
      finalQs();
      return done("green");
    }
    return responders("yellow");
  }

  // Advice line, no escalation
  finalQs();
  if (!opts.adviceHealthDirect) {
    reasons.push("Advice call with no escalation criteria: hand over to the DOM.");
    return done("green");
  }
  if (isAdviceOvernight(at)) {
    reasons.push("Advice call between 23:00 and 08:00: Health Direct.");
    return done("purple");
  }
  q.push("community_org", "worse_last_2h");
  if (i.calling_from_community_org === null || i.worse_last_2h === null) return done(null, false);
  if (i.calling_from_community_org || i.worse_last_2h) {
    reasons.push("Community organisation, or significantly worse in the last 2 hours: DOM.");
    return done("green");
  }
  reasons.push("Non-urgent advice: Health Direct.");
  return done("purple");
}

// ───────────────────────── Location ─────────────────────────

/** what3words: three words separated by dots, optional leading "///". */
export const W3W_RE = /^(?:\/\/\/)?[\p{L}]+\.[\p{L}]+\.[\p{L}]+$/u;

export function normaliseW3W(v: string): string {
  return v.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "");
}

export function w3wUrl(v: string): string | null {
  const n = normaliseW3W(v);
  return n && W3W_RE.test(n) ? `https://what3words.com/${n}` : null;
}

/** Location is hard to pin down: no street number (e.g. "far side of Nielsen Park"). */
export function locationNeedsHelp(i: Pick<Intake, "street_address" | "address_details">): boolean {
  return i.street_address.trim().length > 0 && !/\d/.test(i.street_address);
}
