// During-phase prompts (Dispatcher Manual, section 3):
//  * On air: a dispatched responder should announce "on air" within 5 minutes. If not, radio,
//    then phone; after two unanswered calls contact the DOM.
//  * Sitrep: within 3 minutes of the first responder arriving on scene.
//  * Welfare check: after 30 minutes of radio silence (15 overnight).
//  * Echo / no radio: not on scene within 5 minutes of ETA → call them directly (resources p.10).

import { isNight } from "./time";
import { isEchoGrade, type AssignmentStatus, type Rank } from "./types";

export const WELFARE_GRACE_MIN = 5;
export const ON_AIR_MIN = 5;
export const SITREP_MIN = 3;
export const RADIO_SILENCE_MIN = 30;
export const RADIO_SILENCE_NIGHT_MIN = 15;

export interface WelfareSubject {
  responder_id: string;
  call_sign: string;
  rank: Rank;
  has_radio: boolean;
  status: AssignmentStatus;
  /** When the ETA was given (the offer, or the reassignment). */
  eta_from: string | null;
  eta_minutes: number | null;
  instruction_at?: string | null;
  on_air_at?: string | null;
  on_scene_at: string | null;
  last_welfare_check_at: string | null;
}

export interface WelfareDue {
  responder_id: string;
  call_sign: string;
  overdueMinutes: number;
}

const ms = (min: number) => min * 60000;
const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

export function welfareChecksDue(subjects: WelfareSubject[], now: Date = new Date()): WelfareDue[] {
  const out: WelfareDue[] = [];
  for (const s of subjects) {
    if (s.status !== "go" || s.on_scene_at || !s.eta_from || s.eta_minutes === null) continue;
    if (!isEchoGrade(s.rank) && s.has_radio) continue;
    const dueAt = new Date(s.eta_from).getTime() + ms(s.eta_minutes + WELFARE_GRACE_MIN);
    if (s.last_welfare_check_at && new Date(s.last_welfare_check_at).getTime() >= dueAt) continue;
    const overdue = Math.floor((now.getTime() - dueAt) / 60000);
    if (overdue >= 0) out.push({ responder_id: s.responder_id, call_sign: s.call_sign, overdueMinutes: overdue });
  }
  return out;
}

export type PromptKind = "on_air" | "sitrep" | "radio_silence" | "echo_welfare" | "echo_wait";

export interface Prompt {
  kind: PromptKind;
  responder_id?: string;
  text: string;
  /** Suggested radio call, phonetic. */
  radio?: string;
}

const PHONETIC: Record<string, string> = { A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", I: "India" };
export function phonetic(callSign: string): string {
  const m = callSign.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return callSign;
  return `${m[1].toUpperCase().split("").map((c) => PHONETIC[c] ?? c).join(" ")} ${m[2]}`;
}

export function duringPhasePrompts(opts: {
  subjects: WelfareSubject[];
  /** Last radio contact or control action on this incident. */
  lastContactAt: string | null;
  sitrepAt: string | null;
  now?: Date;
}): Prompt[] {
  const now = opts.now ?? new Date();
  const t = now.getTime();
  const out: Prompt[] = [];
  const going = opts.subjects.filter((s) => s.status === "go");

  for (const s of going) {
    // Echoes don't carry radios, so "on air" applies to radio holders only.
    const start = time(s.instruction_at) ?? time(s.eta_from);
    if (s.has_radio && !isEchoGrade(s.rank) && !s.on_air_at && !s.on_scene_at && start && t - start >= ms(ON_AIR_MIN)) {
      const name = phonetic(s.call_sign);
      out.push({
        kind: "on_air",
        responder_id: s.responder_id,
        text: `${s.call_sign} has not announced "on air" after ${ON_AIR_MIN} min. Radio, then phone. After two unanswered calls, contact the DOM.`,
        radio: `${name}, ${name} from Control. Please confirm you are on air.`,
      });
    }
  }
  for (const w of welfareChecksDue(opts.subjects, now)) {
    out.push({
      kind: "echo_welfare",
      responder_id: w.responder_id,
      text: `${w.call_sign} is ${w.overdueMinutes + WELFARE_GRACE_MIN}+ min past ETA without arriving and has no radio. Call them directly.`,
    });
  }

  const firstOnScene = going
    .concat(opts.subjects.filter((s) => s.status === "cleared"))
    .map((s) => time(s.on_scene_at))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b)[0];
  if (firstOnScene && !opts.sitrepAt && t - firstOnScene >= ms(SITREP_MIN)) {
    const lead = going.find((s) => time(s.on_scene_at) === firstOnScene);
    const name = lead ? phonetic(lead.call_sign) : "Responder";
    out.push({ kind: "sitrep", responder_id: lead?.responder_id, text: `No sitrep ${SITREP_MIN} min after arrival on scene.`, radio: `${name}, ${name} from Control. Please provide a sitrep.` });
  }

  const deltaOnScene = going.some((s) => s.on_scene_at && !isEchoGrade(s.rank));
  for (const s of going) {
    if (s.rank === "echo" && s.on_scene_at && !deltaOnScene) {
      out.push({ kind: "echo_wait", responder_id: s.responder_id, text: `${s.call_sign} (Echo) is on scene. Echoes wait outside until a Delta+ is on scene.` });
    }
  }

  const silence = isNight(now) ? RADIO_SILENCE_NIGHT_MIN : RADIO_SILENCE_MIN;
  const last = time(opts.lastContactAt);
  if (going.some((s) => s.on_scene_at) && last && t - last >= ms(silence)) {
    out.push({ kind: "radio_silence", text: `${Math.floor((t - last) / 60000)} min of radio silence. Do a welfare check.`, radio: "Just doing a welfare check." });
  }
  return out;
}
