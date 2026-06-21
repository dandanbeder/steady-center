/**
 * Cost-anchored credit config. Shared (client + server), pure.
 *
 * 1 credit = a fixed slice of true cost (the "anchor").
 * Each AI call charges credits derived from its MEASURED cost in
 * `ai_usage_events.true_cost_micros` (see ai-budget.server.ts), never from
 * a guessed per-action weight. Weights below are only a fallback for calls
 * where we have no cost signal (free helpers, missing token counts).
 *
 * Recipe to recalibrate weights from real data (run quarterly):
 *   SELECT action_type,
 *          ceil(percentile_cont(0.5) WITHIN GROUP (ORDER BY true_cost_micros) / 2500)
 *     FROM public.ai_usage_events
 *     WHERE created_at > now() - interval '30 days'
 *     GROUP BY 1;
 */
import type { AiActionType } from "./credits-types";

/** One credit = 2500 micro-USD = $0.0025 = 0.25¢. */
export const CREDIT_ANCHOR_MICROS = 2500;

/**
 * Fallback weights when `true_cost_micros` is 0 (no token data).
 * Derived from observed median costs; conservative (rounded up).
 */
export const ACTION_WEIGHTS: Record<AiActionType, number> = {
  assistant: 6,
  coach: 4,
  transcribe: 2,
  journal_reflect: 2,
  notes_ai: 1,
  notes_journal: 1,
  outcomes_ai: 1,
  task_views_ai: 1,
  inbox_ai: 1,
  daily_pulse: 1,
  weekly_plan: 5,
  weekly_report: 5,
  team_progress: 5,
  other: 1,
};

/** Compute credits to charge for an event. Always returns ≥ 1. */
export function creditsFor(opts: {
  trueCostMicros: number;
  actionType: AiActionType;
}): number {
  if (opts.trueCostMicros > 0) {
    return Math.max(1, Math.ceil(opts.trueCostMicros / CREDIT_ANCHOR_MICROS));
  }
  return Math.max(1, ACTION_WEIGHTS[opts.actionType] ?? 1);
}

export const CREDITS_EXHAUSTED_PREFIX = "CREDITS_EXHAUSTED:";

/** True if the error came from the hard-stop path (allowance + purchased empty). */
export function isCreditsExhaustedError(e: unknown): boolean {
  if (!e) return false;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.startsWith(CREDITS_EXHAUSTED_PREFIX);
}
