/**
 * AI model routing + context caps.
 *
 * Two cost controls live here:
 *
 * 1. MODEL ROUTING — every action_type maps to either a "light" (Haiku-class)
 *    or "reasoning" (Sonnet-class) model. Light is the default for
 *    extraction, title/tag suggestions, classification. Reasoning is
 *    reserved for summaries, planning, and cross-content asks.
 *    Sub-actions (e.g. "notes_ai:suggest_meta") can override the
 *    file-level route to escape the all-or-nothing trap.
 *
 * 2. CONTEXT CAPS — every route advertises a maxInputChars,
 *    maxOutputTokens, and (for long lists) maxContextItems and
 *    maxTranscriptChars. Callers MUST apply these before building the
 *    prompt; cap hits are logged via logCapHit (server module) so we
 *    can see when truncation is silently changing answer quality.
 *
 * Client-safe: this module only exports config + pure helpers. The
 * cap-hit logger lives in `ai-routing.server.ts`.
 */
import type { AiActionType } from "./credits-types";

export type ModelTier = "light" | "reasoning";

export interface ModelRoute {
  tier: ModelTier;
  model: string;
  /** Hard cap on user/context body chars. Truncate + log when exceeded. */
  maxInputChars: number;
  /** Max output tokens to request from the model. */
  maxOutputTokens: number;
  /** Hard cap on items (notes/tasks/etc) packed into a prompt. */
  maxContextItems?: number;
  /** Per-transcript/summary chunk cap (used by long-form summarisers). */
  maxTranscriptChars?: number;
}

// Tier defaults. Update model strings here once when a new tier shippable model lands.
export const LIGHT_MODEL = "claude-haiku-4-5";
export const REASONING_MODEL = "claude-sonnet-4-5";

const DEFAULT_LIGHT: ModelRoute = {
  tier: "light",
  model: LIGHT_MODEL,
  maxInputChars: 12_000,
  maxOutputTokens: 800,
  maxContextItems: 25,
  maxTranscriptChars: 4_000,
};

const DEFAULT_REASONING: ModelRoute = {
  tier: "reasoning",
  model: REASONING_MODEL,
  maxInputChars: 60_000,
  maxOutputTokens: 2_000,
  maxContextItems: 60,
  maxTranscriptChars: 16_000,
};

/**
 * Routing table. Keys are either an AiActionType or a "<actionType>:<subAction>"
 * override. The latter wins when present.
 */
export const AI_ROUTING: Record<string, ModelRoute> = {
  // ───── Reasoning (real synthesis / planning / cross-content) ─────
  assistant: { ...DEFAULT_REASONING, maxOutputTokens: 1_500 },
  notes_ai: { ...DEFAULT_REASONING, maxOutputTokens: 1_600 },
  notes_journal: { ...DEFAULT_REASONING, maxInputChars: 80_000, maxOutputTokens: 2_500 },
  outcomes_ai: { ...DEFAULT_REASONING, maxOutputTokens: 1_500 },
  weekly_plan: { ...DEFAULT_REASONING, maxOutputTokens: 2_500 },
  weekly_report: { ...DEFAULT_REASONING, maxInputChars: 120_000, maxOutputTokens: 3_000 },
  team_progress: { ...DEFAULT_REASONING, maxInputChars: 80_000, maxOutputTokens: 2_500 },

  // ───── Light (extraction / suggestions / triage) ─────
  coach: { ...DEFAULT_LIGHT, maxOutputTokens: 600 },
  journal_reflect: { ...DEFAULT_LIGHT, maxOutputTokens: 800 },
  task_views_ai: { ...DEFAULT_LIGHT, maxOutputTokens: 600 },
  inbox_ai: { ...DEFAULT_LIGHT, maxOutputTokens: 600 },
  daily_pulse: { ...DEFAULT_LIGHT, maxOutputTokens: 800 },
  transcribe: { ...DEFAULT_LIGHT, model: "openai/gpt-4o-mini-transcribe", maxOutputTokens: 0 },
  other: { ...DEFAULT_LIGHT },

  // ───── Sub-action overrides ─────
  // Title/folder/people suggestions are simple extraction → light.
  "notes_ai:suggest_meta": { ...DEFAULT_LIGHT, maxOutputTokens: 800 },
  // Pulling explicit todos out of a note is extraction → light.
  "notes_ai:extract_actions": { ...DEFAULT_LIGHT, maxInputChars: 20_000, maxOutputTokens: 1_200 },
  // Cleaning up dictation is mechanical → light.
  "notes_ai:cleanup_transcript": { ...DEFAULT_LIGHT, maxInputChars: 20_000, maxOutputTokens: 1_800 },
  // Brain-dump → structured note still benefits from reasoning (kept).
};

/** Resolve the model + caps for an action, with optional sub-action override. */
export function routeModel(actionType: AiActionType, subAction?: string): ModelRoute {
  if (subAction) {
    const key = `${actionType}:${subAction}`;
    const hit = AI_ROUTING[key];
    if (hit) return hit;
  }
  return AI_ROUTING[actionType] ?? AI_ROUTING.other;
}

export interface CapResult {
  text: string;
  truncated: boolean;
  originalChars: number;
  cappedChars: number;
}

/** Pure helper: clip text to maxChars and report whether the cap fired. */
export function applyContextCap(text: string, maxChars: number): CapResult {
  const original = text?.length ?? 0;
  if (!text || original <= maxChars) {
    return { text: text ?? "", truncated: false, originalChars: original, cappedChars: original };
  }
  return {
    text: text.slice(0, maxChars),
    truncated: true,
    originalChars: original,
    cappedChars: maxChars,
  };
}
