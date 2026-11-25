// "Escalation / Emergency Terms" matrix (July 2025 draft) and the Vital Signs chart
// (Dispatcher Manual, Resource 2). Matching only *prompts* the dispatcher; they answer the
// "Emergency Complaint?" question themselves.

import type { SpecialCall } from "./types";

export type EscalationCategory =
  | "altered_consciousness"
  | "abnormal_breathing"
  | "uncontrolled_bleeding"
  | "chest_pain"
  | "major_trauma"
  | "stroke_signs"
  | "vital_signs"
  | "envenomation"
  | "fall_still_on_ground"
  | "traffic_accident"
  | "allergic_reaction"
  | "seizure"
  | "severe_burn"
  | "fracture"
  | "choking"
  | "paediatric"
  | "diabetic"
  | "overdose"
  | "severe_pain"
  | "pregnancy"
  | "suicide_self_harm"
  | "assault_aggression"
  | "drug_related";

export interface CategoryDef {
  key: EscalationCategory;
  label: string;
  terms: RegExp[];
  /** Advice-line exception: stays an advice call unless other criteria are met. */
  adviceException?: boolean;
  /** Blackbox: Red pathway, add 112, hand to the DOM; no responders without DOM approval. */
  blackbox?: boolean;
  /** Acceptable clarifying questions any dispatcher can ask. */
  clarify?: string[];
}

const t = (...xs: string[]) => xs.map((x) => new RegExp(x, "i"));

export const ESCALATION_MATRIX: CategoryDef[] = [
  {
    key: "altered_consciousness",
    label: "Altered consciousness",
    terms: t("not responsive", "unresponsive", "not awake", "not alert", "unconscious", "lost conscious", "loss of conscious", "sleepy", "drowsy", "out of it", "dazed", "confused", "delirious", "not waking", "passed out", "faint", "vasovagal", "collapsed"),
  },
  {
    key: "abnormal_breathing",
    label: "Difficulty / abnormal breathing",
    terms: t("short(ness)? of breath", "gasping", "wheez", "shallow breathing", "heavy breathing", "struggling to breathe", "can'?t (catch their )?breath", "cannot catch", "asthma", "hyperventilat", "blue in the face", "laboured breathing", "can'?t speak properly", "strange breathing", "breathing noise", "difficulty breathing", "not breathing", "stopped breathing"),
  },
  {
    key: "uncontrolled_bleeding",
    label: "Uncontrolled bleeding",
    terms: t("severe bleed", "bleeding that won'?t stop", "won'?t stop bleeding", "spurting", "pool of blood", "lots of blood", "haemorrhag", "hemorrhag"),
    clarify: ["Are you on blood thinners?"],
  },
  {
    key: "chest_pain",
    label: "Chest pain / heart-related",
    terms: t("palpitation", "racing heart", "rapid heart", "chest pain", "pain in (the )?ribs", "pain above (the )?stomach", "crushing pain", "tight(ness)? in (the )?chest", "chest tight", "pressure in (the )?chest", "discomfort in (the )?chest", "indigestion", "arm pain", "jaw pain", "tingling", "irregular heart", "abnormal heart", "arrhythmia", "heart attack", "cardiac"),
    clarify: ["Do you have pain in your chest?"],
  },
  {
    key: "major_trauma",
    label: "Injury after a severe accident or trauma",
    terms: t("severe trauma", "major (open )?wound", "open wound", "fall from (a )?(significant )?height", "fell from (a )?height", "fallen down (multiple )?stairs", "fell down (the )?stairs", "vehicle crash", "collision", "bike", "scooter", "stabb", "shoot", "explosion", "deformity", "limb .*wrong"),
    clarify: ["Was the fall from greater than your own height?"],
  },
  {
    key: "stroke_signs",
    label: "Difficulty moving or speaking, facial droop, confusion",
    terms: t("mumbl", "slurr", "stroke", "facial droop", "face drooping", "sudden.*dizz", "lightheaded", "double vision", "unsteady walk", "not acting (like )?(their|them)sel", "not (their|her|his) normal sel"),
  },
  {
    key: "vital_signs",
    label: "Concern about vital signs (chart)",
    terms: t("blood pressure", "\\bbp\\b", "heart rate", "\\bpulse\\b", "temperature", "\\btemp\\b", "fever", "febrile", "oxygen", "sats", "spo2"),
    adviceException: true,
  },
  {
    key: "envenomation",
    label: "Envenomation / bitten by",
    terms: t("snake", "funnel.?web", "black spider", "spider bite", "blue.?ring", "octopus", "cone shell", "envenom"),
  },
  {
    key: "fall_still_on_ground",
    label: "Fall and has not got back up",
    terms: t("\\bfall\\b", "fallen", "\\bfell\\b", "on the (ground|floor)", "can'?t get up"),
    clarify: ["Are they still on the ground?"],
  },
  { key: "traffic_accident", label: "Traffic accident", terms: t("\\bcar\\b", "vehicle", "pedestrian", "hit.and.run", "ramming", "\\bmva\\b", "motor vehicle", "hit by") },
  {
    key: "allergic_reaction",
    label: "Allergic reaction",
    terms: t("allerg", "anaphyla", "swelling (of )?(the )?(face|throat|lips)", "swollen (face|throat|lips)", "hives", "serious rash", "reaction to"),
    clarify: ["Have you had anaphylaxis before?"],
  },
  {
    key: "seizure",
    label: "Seizure",
    terms: t("seizure", "fitting", "having a fit", "epilep", "convuls", "uncontrollable shaking", "gone stiff", "floppy"),
  },
  {
    key: "severe_burn",
    label: "Severe burn",
    terms: t("burn", "scald", "chemical", "fire", "coughing from smoke", "smoke inhal"),
    adviceException: true,
  },
  { key: "fracture", label: "Fracture / broken bone", terms: t("fracture", "broken (bone|arm|leg|wrist|hip|ankle)", "bone sticking out", "deformed", "dislocat") },
  { key: "choking", label: "Choking", terms: t("chok", "clutching (their )?throat") },
  { key: "paediatric", label: "Paediatric concerns", terms: t("floppy baby", "blue baby", "mottled", "grunting", "croup") },
  { key: "diabetic", label: "Diabetic problem", terms: t("diabet", "hypo\\b", "low (blood )?sugar", "\\bbgl\\b") },
  { key: "overdose", label: "Overdose", terms: t("overdose", "\\bod\\b", "took too many") },
  {
    key: "severe_pain",
    label: "Severe pain",
    terms: t("severe pain", "lots of pain", "very painful", "going to pass out", "worst headache", "excruciating"),
    adviceException: true,
    clarify: ["Is this a sudden onset or an ongoing pain?", "Is this the worst headache of your life, and did it come on suddenly?"],
  },
  { key: "pregnancy", label: "Pregnancy-related", terms: t("pregnan", "labour", "labor\\b", "waters broke", "vaginal bleed", "contraction") },
  {
    key: "suicide_self_harm",
    label: "Suicide / self-harm",
    terms: t("suicid", "self.?harm", "hurting (them|her|him)sel", "manic", "psychotic", "hallucinat", "kill (my|him|her|them)sel"),
    blackbox: true,
  },
  { key: "assault_aggression", label: "Assault / aggression", terms: t("assault", "punch", "kick", "strik", "fight", "brawl", "screaming", "shouting", "aggress", "attacked"), blackbox: true },
  { key: "drug_related", label: "Drug related", terms: t("\\bice\\b", "meth", "stimulant", "\\bghb\\b", "heroin"), blackbox: true },
];

export const CATEGORY_BY_KEY = Object.fromEntries(ESCALATION_MATRIX.map((c) => [c.key, c])) as Record<EscalationCategory, CategoryDef>;

export function matchEscalation(text: string): CategoryDef[] {
  if (!text.trim()) return [];
  return ESCALATION_MATRIX.filter((c) => c.terms.some((re) => re.test(text)));
}

// ───────────────────────── Vital signs (Resource 2) ─────────────────────────

export interface VitalSigns {
  heart_rate?: number | null;
  systolic_bp?: number | null;
  temp?: number | null;
  bgl?: number | null;
  spo2?: number | null;
  /** Patient age in days, only needed for infant fever rules. */
  age_days?: number | null;
}

export function vitalRedFlags(v: VitalSigns): string[] {
  const out: string[] = [];
  const n = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
  if (n(v.heart_rate) && v.heart_rate < 50) out.push(`Heart rate ${v.heart_rate} (< 50)`);
  if (n(v.heart_rate) && v.heart_rate > 140) out.push(`Heart rate ${v.heart_rate} (> 140)`);
  if (n(v.systolic_bp) && v.systolic_bp < 90) out.push(`Systolic BP ${v.systolic_bp} (< 90)`);
  if (n(v.systolic_bp) && v.systolic_bp > 200) out.push(`Systolic BP ${v.systolic_bp} (> 200)`);
  if (n(v.temp) && v.temp > 41) out.push(`Temp ${v.temp} (> 41)`);
  if (n(v.bgl) && v.bgl < 3) out.push(`BGL ${v.bgl} (< 3)`);
  if (n(v.bgl) && v.bgl > 12) out.push(`BGL ${v.bgl} (> 12)`);
  if (n(v.spo2) && v.spo2 < 92) out.push(`SpO2 ${v.spo2}% (< 92)`);
  if (n(v.temp) && n(v.age_days)) {
    if (v.age_days < 30 && v.temp > 37) out.push(`Infant under 30 days with temp ${v.temp} (> 37)`);
    else if (v.age_days < 92 && v.temp > 39) out.push(`Infant under 3 months with temp ${v.temp} (> 39)`);
  }
  return out;
}

// ───────────────────────── Special calls (allocation grid) ─────────────────────────

const SPECIAL: { re: RegExp; special: SpecialCall }[] = [
  { re: /cardiac arrest|\bcpr\b|no pulse|goodsam|good sam/i, special: "cardiac_arrest" },
  { re: /not breathing|stopped breathing/i, special: "not_breathing" },
  { re: /unconscious|unresponsive|not responsive|not waking/i, special: "unconscious" },
  { re: /\bmva\b|car (crash|accident)|motor vehicle|vehicle (crash|collision)|hit by (a )?(car|vehicle)|pedestrian/i, special: "mva" },
  { re: /mass casualty|\bmci\b|multiple (patients|casualties)/i, special: "mci" },
];

/** A GoodSAM alert is a cardiac arrest / not breathing call (Manual p.23). */
export function detectSpecialCall(text: string): SpecialCall | null {
  return SPECIAL.find((s) => s.re.test(text))?.special ?? null;
}
