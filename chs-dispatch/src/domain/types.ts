// Shared domain vocabulary. Mirrors the enums in supabase/migrations.

export type Role = "dispatcher" | "dom" | "responder" | "clinical" | "admin";

/** CHS ranks. "Delta and above" (Delta+) = alpha, bravo, charlie, delta. */
export type Rank = "alpha" | "bravo" | "charlie" | "delta" | "intermediate_echo" | "echo";

export type CallSource = "hotline" | "goodsam" | "radio" | "chs_member" | "dom_direct";
export type Hotline = "emergency" | "advice" | "unknown";

export type Pathway =
  | "red_in_area"
  | "red_out_of_area"
  | "yellow"
  | "green"
  | "purple"
  | "dom_direct"
  | "no_action";

export type SpecialCall = "unconscious" | "mva" | "cardiac_arrest" | "not_breathing" | "mci";

export type IncidentStatus = "intake" | "dispatching" | "active" | "dom_handover" | "closed" | "cancelled";

/** Lifecycle of one responder on one incident. An offer is only an offer until "go". */
export type AssignmentStatus = "offered" | "go" | "stand_down" | "reassigned" | "cleared";

export type CoverageStatus =
  | "open"
  | "no_further_unless_closer"
  | "no_further_unless_echo"
  | "delta_on_scene";

export type IncidentFlag = "not_from_hotline" | "high_frequency_caller" | "unsafe_situation";

export const DELTA_PLUS: readonly Rank[] = ["alpha", "bravo", "charlie", "delta"];
export const isDeltaPlus = (r: Rank | null | undefined) => !!r && DELTA_PLUS.includes(r);
export const isEchoGrade = (r: Rank | null | undefined) => r === "echo" || r === "intermediate_echo";

export const RANK_LABEL: Record<Rank, string> = {
  alpha: "Alpha",
  bravo: "Bravo",
  charlie: "Charlie",
  delta: "Delta",
  intermediate_echo: "Intermediate Echo",
  echo: "Echo",
};

export const PATHWAY_LABEL: Record<Pathway, string> = {
  red_in_area: "Red (in area)",
  red_out_of_area: "Red (out of area)",
  yellow: "Yellow",
  green: "Green",
  purple: "Purple",
  dom_direct: "DOM direct scenario (Blackbox)",
  no_action: "No action",
};

export const SPECIAL_CALL_LABEL: Record<SpecialCall, string> = {
  unconscious: "Unconscious",
  mva: "MVA",
  cardiac_arrest: "Cardiac arrest",
  not_breathing: "Not breathing",
  mci: "Mass casualty (MCI)",
};

/** Pathways that send CHS responders. */
export const RESPONDER_PATHWAYS: readonly Pathway[] = ["red_in_area", "red_out_of_area", "yellow"];
/** Pathways that go privately to the Duty Operations Manager. */
export const DOM_PATHWAYS: readonly Pathway[] = ["green", "dom_direct"];
