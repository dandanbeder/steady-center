// Welfare rule (resource page 10, footnote 10): if an Echo, or a responder without
// their radio, has not arrived within 5 minutes of their ETA, call them directly.

import { isEchoGrade, type AssignmentStatus, type Rank } from "./types";

export const WELFARE_GRACE_MIN = 5;

export interface WelfareSubject {
  responder_id: string;
  call_sign: string;
  rank: Rank;
  has_radio: boolean;
  status: AssignmentStatus;
  /** When the ETA was given (the offer, or the reassignment). */
  eta_from: string | null;
  eta_minutes: number | null;
  on_scene_at: string | null;
  last_welfare_check_at: string | null;
}

export interface WelfareDue {
  responder_id: string;
  call_sign: string;
  overdueMinutes: number;
}

export function welfareChecksDue(subjects: WelfareSubject[], now: Date = new Date()): WelfareDue[] {
  const out: WelfareDue[] = [];
  for (const s of subjects) {
    if (s.status !== "go" || s.on_scene_at || !s.eta_from || s.eta_minutes === null) continue;
    if (!isEchoGrade(s.rank) && s.has_radio) continue;
    const dueAt = new Date(s.eta_from).getTime() + (s.eta_minutes + WELFARE_GRACE_MIN) * 60000;
    if (s.last_welfare_check_at && new Date(s.last_welfare_check_at).getTime() >= dueAt) continue;
    const overdue = Math.floor((now.getTime() - dueAt) / 60000);
    if (overdue >= 0) out.push({ responder_id: s.responder_id, call_sign: s.call_sign, overdueMinutes: overdue });
  }
  return out;
}
