// The Responder Allocation Grid and rules (resource pages 11-13), as a recommender.
// The dispatcher decides. This shows what the grid says and why.

import { isAllocationNight } from "./time";
import { RANK_LABEL, isDeltaPlus, isEchoGrade, type AssignmentStatus, type Pathway, type Rank, type SpecialCall } from "./types";

export interface Candidate {
  responder_id: string;
  call_sign: string;
  rank: Rank;
  is_ert: boolean;
  has_kit: boolean;
  on_call: boolean;
  eta_minutes: number | null;
  status: AssignmentStatus;
}

export type SlotKind = "delta_plus" | "any" | "echo_only";

export interface Slot {
  kind: SlotKind;
  required: boolean;
  label: string;
  /** Preference wording from the grid, e.g. "ERT preferred". */
  prefer?: string;
}

export interface Requirement {
  label: string;
  night: boolean;
  special: boolean;
  unrestricted: boolean;
  max: number;
  slots: Slot[];
  notes: string[];
}

export type Advice = "go" | "optional" | "stand_down" | "alpha_discretion";

export interface Recommendation {
  responder_id: string;
  advice: Advice;
  slot?: string;
  reason: string;
}

export interface AllocationResult {
  requirement: Requirement;
  recommendations: Recommendation[];
  gaps: string[];
  /** Number already told to go. */
  going: number;
  /** All required slots are held by responders already told to go. */
  minimumMet: boolean;
  coverageHint: "open" | "no_further_unless_closer" | "no_further_unless_echo";
}

const SPECIAL_TYPES: SpecialCall[] = ["unconscious", "mva", "cardiac_arrest", "not_breathing"];

export function requirementFor(opts: { special_call: SpecialCall | null; at: Date }): Requirement {
  const night = isAllocationNight(opts.at);
  if (opts.special_call === "mci") {
    return {
      label: "Mass casualty: unrestricted",
      night,
      special: true,
      unrestricted: true,
      max: Infinity,
      slots: [{ kind: "delta_plus", required: true, label: "Responder 1", prefer: "ERT preferred" }],
      notes: ["Alert East and ERT channels.", "Send every available responder."],
    };
  }
  if (opts.special_call && SPECIAL_TYPES.includes(opts.special_call)) {
    return {
      label: "Special call",
      night,
      special: true,
      unrestricted: false,
      max: 4,
      slots: [
        { kind: "delta_plus", required: true, label: "Responder 1", prefer: "ERT preferred" },
        { kind: "any", required: true, label: "Responder 2", prefer: "Delta+ preferred" },
        { kind: "any", required: false, label: "Responder 3 (preference)" },
        { kind: "any", required: false, label: "Responder 4 (additional)" },
      ],
      notes: ["ERT should be prioritised for special calls.", "Alert East and ERT channels."],
    };
  }
  if (night) {
    return {
      label: "Normal call: night",
      night,
      special: false,
      unrestricted: false,
      max: 3,
      slots: [
        { kind: "delta_plus", required: true, label: "Responder 1" },
        { kind: "any", required: true, label: "Responder 2" },
        { kind: "echo_only", required: false, label: "Responder 3 (Echo only)" },
      ],
      notes: ["Overnight (23:00-06:00) needs a Delta+ and one other responder.", "Only send a 3rd responder if under 10 minutes' difference."],
    };
  }
  return {
    label: "Normal call: day",
    night,
    special: false,
    unrestricted: false,
    max: 3,
    slots: [
      { kind: "delta_plus", required: true, label: "Responder 1" },
      { kind: "any", required: false, label: "Responder 2 (additional)" },
      { kind: "echo_only", required: false, label: "Responder 3 (Echo only)" },
    ],
    notes: [
      "A Delta+ is trained to manage a routine call alone.",
      "The 3rd responder is optional, mainly so an Echo can train. Only send if under 10 minutes' difference.",
    ],
  };
}

const eligible = (slot: SlotKind, c: Candidate) =>
  slot === "delta_plus" ? isDeltaPlus(c.rank) : slot === "echo_only" ? isEchoGrade(c.rank) : true;

const eta = (c: Candidate) => c.eta_minutes ?? 999;

/** Pick the best candidate for a slot. Delta+: ETA, but within 3 minutes prefer ERT (special) then a full kit. */
function pick(slot: Slot, pool: Candidate[], ctx: { special: boolean; red: boolean; leadEta: number | null }): Candidate | null {
  let c = pool.filter((p) => eligible(slot.kind, p));
  if (slot.kind === "echo_only" && ctx.leadEta !== null) c = c.filter((p) => eta(p) - ctx.leadEta! < 10);
  if (!c.length) return null;

  if (slot.kind === "echo_only") {
    // On-call Echoes first irrespective of ETA; for Red, an Intermediate Echo before an Echo.
    return [...c].sort(
      (a, b) =>
        Number(b.on_call) - Number(a.on_call) ||
        (ctx.red ? Number(b.rank === "intermediate_echo") - Number(a.rank === "intermediate_echo") : 0) ||
        eta(a) - eta(b),
    )[0];
  }

  const preferDelta = slot.kind === "any" && (ctx.special || ctx.red);
  const tier = (p: Candidate) => {
    if (slot.kind === "any") {
      if (isDeltaPlus(p.rank)) return preferDelta ? 0 : 1;
      if (p.rank === "intermediate_echo") return ctx.red ? 1 : 2;
      return 2;
    }
    return 0;
  };
  const best = Math.min(...c.map((p) => tier(p) * 1000 + eta(p)));
  // Everyone within a 3 minute window of the best is a near-tie.
  const window = c.filter((p) => tier(p) * 1000 + eta(p) - best <= 3);
  return [...window].sort(
    (a, b) =>
      (ctx.special ? Number(b.is_ert) - Number(a.is_ert) : 0) ||
      Number(b.has_kit) - Number(a.has_kit) ||
      tier(a) - tier(b) ||
      eta(a) - eta(b),
  )[0];
}

function why(c: Candidate, slot: Slot, special: boolean): string {
  const bits = [`${RANK_LABEL[c.rank]}`, c.eta_minutes !== null ? `ETA ${c.eta_minutes} min` : "no ETA"];
  if (special && c.is_ert) bits.push("ERT");
  if (!c.has_kit) bits.push("no kit");
  if (isEchoGrade(c.rank) && c.on_call) bits.push("on call");
  return `${slot.label}: ${bits.join(", ")}`;
}

export function recommend(opts: {
  pathway: Pathway | null;
  special_call: SpecialCall | null;
  at: Date;
  candidates: Candidate[];
}): AllocationResult {
  const req = requirementFor(opts);
  const red = opts.pathway === "red_in_area";
  const live = opts.candidates.filter((c) => c.status === "offered" || c.status === "go");
  const going = live.filter((c) => c.status === "go");
  const recs = new Map<string, Recommendation>();
  const gaps: string[] = [];

  if (req.unrestricted) {
    for (const c of live) recs.set(c.responder_id, { responder_id: c.responder_id, advice: "go", reason: "Mass casualty: send everyone available" });
    return {
      requirement: req,
      recommendations: [...recs.values()],
      gaps: going.some((c) => isDeltaPlus(c.rank)) ? [] : ["No Delta+ assigned yet"],
      going: going.length,
      minimumMet: going.some((c) => isDeltaPlus(c.rank)),
      coverageHint: "open",
    };
  }

  // Responders already told to go hold their slots first; then fill from offers.
  const filled: (Candidate | null)[] = req.slots.map(() => null);
  const ctx = { special: req.special, red, leadEta: null as number | null };
  for (const pool of [going, live.filter((c) => c.status === "offered")]) {
    const remaining = [...pool];
    // Most restrictive slots first so a Delta+ isn't spent on an "any" slot.
    const order = req.slots
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) => Number(b.s.kind !== "any") - Number(a.s.kind !== "any") || a.idx - b.idx);
    for (const { s, idx } of order) {
      if (filled[idx]) continue;
      ctx.leadEta = filled[0] ? eta(filled[0]) : null;
      const c = pick(s, remaining, ctx);
      if (c) {
        filled[idx] = c;
        remaining.splice(remaining.indexOf(c), 1);
      }
    }
  }

  req.slots.forEach((s, idx) => {
    const c = filled[idx];
    if (!c) {
      if (s.required) gaps.push(`${s.label}: need ${s.kind === "delta_plus" ? "a Delta+" : "any responder"}${s.prefer ? ` (${s.prefer})` : ""}`);
      return;
    }
    recs.set(c.responder_id, {
      responder_id: c.responder_id,
      advice: s.required ? "go" : "optional",
      slot: s.label,
      reason: why(c, s, req.special),
    });
  });

  for (const c of live) {
    if (recs.has(c.responder_id)) continue;
    if (c.rank === "alpha") {
      recs.set(c.responder_id, { responder_id: c.responder_id, advice: "alpha_discretion", reason: "Alphas may attend as an extra or alone" });
    } else {
      recs.set(c.responder_id, {
        responder_id: c.responder_id,
        advice: "stand_down",
        reason: going.length >= req.max ? `Call is at its maximum of ${req.max}` : "Slots covered by closer or better-placed responders",
      });
    }
  }

  const requiredFilledByGo = req.slots.every((s, idx) => !s.required || (filled[idx] && filled[idx]!.status === "go"));
  const echoSlotOpen = req.slots.some((s, idx) => s.kind === "echo_only" && !filled[idx]);
  return {
    requirement: req,
    recommendations: [...recs.values()],
    gaps,
    going: going.length,
    minimumMet: requiredFilledByGo,
    coverageHint: !requiredFilledByGo ? "open" : echoSlotOpen ? "no_further_unless_echo" : "no_further_unless_closer",
  };
}
