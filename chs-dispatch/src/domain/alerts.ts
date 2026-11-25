// Internal Messenger alert policy (resource pages 8-9, 11).

import type { SpecialCall } from "./types";

export const CHANNELS = [
  { id: 1, name: "EAST (Main Channel)", note: "Main channel" },
  { id: 2, name: "Maroubra", note: "South East" },
  { id: 3, name: "North", note: "North Shore" },
  { id: 4, name: "SURGE", note: "Used only if surge responders required; DMR only" },
  { id: 5, name: "ERT Escalation", note: "ERT members only" },
  { id: 6, name: "Dispatchers", note: "" },
  { id: 7, name: "DOM", note: "DOMs only" },
  { id: 8, name: "Bravo", note: "" },
  { id: 9, name: "Training", note: "" },
] as const;

export const MAX_ALERT_ATTEMPTS = 3;
export const REALERT_AFTER_MS = 60_000;

const SOUTH_EAST = /maroubra|coogee|clovelly|randwick|kingsford|kensington|malabar|matraville|la perouse|little bay|chifley|pagewood|hillsdale|south coogee/i;
const NORTH = /mosman|neutral bay|cremorne|kirribilli|north sydney|manly|chatswood|lane cove|crows nest|cammeray|balgowlah|dee why|st leonards/i;

/** Channels to alert for a call. Special calls and MCIs always include East and ERT. */
export function suggestChannels(suburb: string, special: SpecialCall | null): number[] {
  const set = new Set<number>([1]);
  if (SOUTH_EAST.test(suburb)) set.add(2);
  if (NORTH.test(suburb)) set.add(3);
  if (special) set.add(5);
  return [...set].sort((a, b) => a - b);
}

export interface AlertState {
  attempts: number;
  lastSentAt: string | null;
  /** Responders already told to go. */
  going: number;
  special: boolean;
  /** Dispatcher has begun allocating (an alert is still always sent before this). */
  allocationStarted: boolean;
}

export type AlertDecision =
  | { kind: "send_first" }
  | { kind: "wait"; msRemaining: number; attempt: number }
  | { kind: "resend"; attempt: number }
  | { kind: "enough"; reason: string }
  | { kind: "exhausted" };

/**
 * After 1 minute with no or too few responders, re-send; then once more 1 minute later.
 * No more than 3 sends. Stop once 2+ are going, unless it's a special call.
 */
export function alertDecision(s: AlertState, now: number = Date.now()): AlertDecision {
  if (s.attempts === 0) return { kind: "send_first" };
  if (s.attempts >= MAX_ALERT_ATTEMPTS) return { kind: "exhausted" };
  if (s.going >= 2 && !s.special) return { kind: "enough", reason: "2 or more responders going" };
  const elapsed = s.lastSentAt ? now - new Date(s.lastSentAt).getTime() : Infinity;
  if (elapsed < REALERT_AFTER_MS) return { kind: "wait", msRemaining: REALERT_AFTER_MS - elapsed, attempt: s.attempts + 1 };
  return { kind: "resend", attempt: s.attempts + 1 };
}
