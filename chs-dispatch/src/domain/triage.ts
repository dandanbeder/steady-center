// Encodes the CHS Emergency and Advice pathway flowcharts (resource pages 5-6).
// The engine only *suggests*. The dispatcher chooses the pathway; an override is recorded.

import { isAdviceOvernight } from "./time";
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
  main_problem: string;
  /** "Are there any 'Emergency Complaints' immediately identified?" */
  emergency_complaint: boolean | null;
  // The three questions
  alert_talking: boolean | null;
  breathing_normally: boolean | null;
  uncontrolled_bleeding: boolean | null;
  // Advice, 08:00-23:00 branch
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
  main_problem: "",
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
  return Object.fromEntries(keys.map((k) => [k, row[k]])) as unknown as Intake;
}

export type ScriptNo = 1 | 2 | 3 | 4;

export interface Script {
  no: ScriptNo;
  title: string;
  /** What the dispatcher says/does, in order. */
  actions: string[];
}

export const SCRIPTS: Record<ScriptNo, Script> = {
  1: {
    no: 1,
    title: "Script 1: Emergency, Triple Zero & Responders",
    actions: ["Dispatch CHS responders", "Add Triple Zero (000/112) to the call", "Send Internal Messenger alert"],
  },
  2: {
    no: 2,
    title: "Script 2: Responders only",
    actions: ["Dispatch CHS responders", "Send Internal Messenger alert"],
  },
  3: {
    no: 3,
    title: "Script 3: Advice (DOM)",
    actions: [
      "Explain that a DOM or health care professional will contact them shortly",
      "Hang up. Call the DOM on 1300 247 679, press 0, and hand over",
    ],
  },
  4: {
    no: 4,
    title: "Script 4: Advice (Health Direct)",
    actions: ["Confirm the caller is fine to be transferred to Health Direct", "Transfer to Health Direct"],
  },
};

export const PATHWAY_SCRIPT: Partial<Record<Pathway, ScriptNo>> = {
  red_in_area: 1,
  yellow: 2,
  green: 3,
  purple: 4,
};

/** Words that suggest an Emergency Complaint. Only a prompt: the dispatcher answers the question. */
const EMERGENCY_TERMS: { re: RegExp; special?: SpecialCall }[] = [
  { re: /cardiac arrest|\bcpr\b|no pulse/i, special: "cardiac_arrest" },
  { re: /not breathing|stopped breathing|apn(o)?ea/i, special: "not_breathing" },
  { re: /unconscious|unresponsive|collapsed|passed out|not waking/i, special: "unconscious" },
  { re: /\bmva\b|car (crash|accident)|motor vehicle|hit by (a )?(car|vehicle)|pedestrian struck/i, special: "mva" },
  { re: /mass casualty|\bmci\b|multiple (patients|casualties)/i, special: "mci" },
  { re: /heart attack|chest pain/i },
  { re: /stroke|face drooping|slurred speech/i },
  { re: /seizure|fitting|convuls/i },
  { re: /anaphyla|severe allerg/i },
  { re: /chok/i },
  { re: /overdose/i },
  { re: /severe bleeding|haemorrhag|hemorrhag/i },
  { re: /difficulty breathing|can'?t breathe|short(ness)? of breath/i },
];

export function detectEmergencyTerms(problem: string): { matched: boolean; special: SpecialCall | null } {
  let matched = false;
  let special: SpecialCall | null = null;
  for (const t of EMERGENCY_TERMS) {
    if (t.re.test(problem)) {
      matched = true;
      if (t.special && !special) special = t.special;
    }
  }
  return { matched, special };
}

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
  /** True once enough has been answered to make a suggestion. */
  complete: boolean;
  suggested: Pathway | null;
  script: Script | null;
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

export function triage(i: Intake, at: Date = new Date()): TriageResult {
  const q: QuestionKey[] = ["address", "main_problem", "emergency_complaint"];
  const reasons: string[] = [];
  const done = (suggested: Pathway | null, complete = true): TriageResult => ({
    questions: q,
    complete,
    suggested,
    script: suggested && PATHWAY_SCRIPT[suggested] ? SCRIPTS[PATHWAY_SCRIPT[suggested]!] : null,
    reasons,
  });

  if (i.call_source === "dom_direct") {
    reasons.push("Incident raised directly by the DOM.");
    return done("dom_direct");
  }

  const red = (): TriageResult => {
    q.push("onscene_contact", "confirm_address", "patient_age");
    if (!i.in_area) {
      reasons.push("Address is outside the CHS response area: connect the caller to Triple Zero.");
      return done("red_out_of_area");
    }
    return done("red_in_area");
  };

  if (i.emergency_complaint === null) return done(null, false);

  if (i.emergency_complaint) {
    reasons.push("Emergency Complaint identified.");
    return red();
  }

  reasons.push("No initial emergency indications.");
  q.push("three_questions");
  if (!threeQuestionsAnswered(i)) return done(null, false);

  if (threeQuestionsRed(i)) {
    if (i.alert_talking === false) reasons.push("Patient is not alert and talking appropriately.");
    if (i.breathing_normally === false) reasons.push("Patient is not breathing normally.");
    if (i.uncontrolled_bleeding === true) reasons.push("Uncontrolled bleeding.");
    return red();
  }
  reasons.push("Alert and talking, breathing normally, no uncontrolled bleeding.");

  if (i.hotline !== "advice") {
    // Emergency pathway, dotted yellow line: responders only.
    q.push("onscene_contact", "confirm_address", "patient_age");
    if (!i.in_area) {
      reasons.push("Address is outside the CHS response area.");
      return done("no_action");
    }
    return done("yellow");
  }

  // Advice pathway
  if (isAdviceOvernight(at)) {
    reasons.push("Advice call between 23:00 and 08:00: Health Direct.");
    return done("purple");
  }
  q.push("community_org", "worse_last_2h");
  if (i.calling_from_community_org === null || i.worse_last_2h === null) return done(null, false);
  if (i.calling_from_community_org && i.worse_last_2h) {
    reasons.push("Calling from a community organisation and significantly worse in the last 2 hours: DOM handover.");
    return done("green");
  }
  reasons.push("Not a community organisation with a change in the last 2 hours: Health Direct.");
  return done("purple");
}
