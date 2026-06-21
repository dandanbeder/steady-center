/**
 * Server-side helpers for AI routing: cap-hit audit log.
 * Pairs with `ai-routing.ts` (client-safe routing table + pure helpers).
 *
 * `logCapHit` is best-effort and never throws, telemetry must not break
 * the user-facing AI call.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AiActionType } from "./credits-types";
import { applyContextCap, type CapResult } from "./ai-routing";

export { routeModel, applyContextCap, AI_ROUTING, LIGHT_MODEL, REASONING_MODEL } from "./ai-routing";
export type { ModelRoute, ModelTier, CapResult } from "./ai-routing";

export type CapKind = "input_chars" | "transcript_chars" | "context_items" | "output_tokens";

export async function logCapHit(opts: {
  userId?: string | null;
  actionType: AiActionType;
  subAction?: string | null;
  capKind: CapKind;
  capValue: number;
  observedValue: number;
  model?: string | null;
}): Promise<void> {
  try {
    console.warn(
      `[ai-cap] ${opts.actionType}${opts.subAction ? `:${opts.subAction}` : ""} ${opts.capKind} ${opts.observedValue}→${opts.capValue}`,
    );
    await (supabaseAdmin.from("ai_cap_hits" as any) as any).insert({
      user_id: opts.userId ?? null,
      action_type: opts.actionType,
      sub_action: opts.subAction ?? null,
      cap_kind: opts.capKind,
      cap_value: opts.capValue,
      observed_value: opts.observedValue,
      model_used: opts.model ?? null,
    });
  } catch (e) {
    console.warn("[ai-cap] log insert failed", e);
  }
}

/**
 * Convenience: clip text and fire-and-forget a cap-hit row when truncation
 * happens. Returns the (possibly clipped) text.
 */
export function capAndLog(
  text: string,
  opts: {
    userId?: string | null;
    actionType: AiActionType;
    subAction?: string;
    maxChars: number;
    capKind?: CapKind;
    model?: string;
  },
): CapResult {
  const r = applyContextCap(text, opts.maxChars);
  if (r.truncated) {
    void logCapHit({
      userId: opts.userId,
      actionType: opts.actionType,
      subAction: opts.subAction ?? null,
      capKind: opts.capKind ?? "input_chars",
      capValue: r.cappedChars,
      observedValue: r.originalChars,
      model: opts.model,
    });
  }
  return r;
}

/** Cap an array of items (e.g. notes, tasks) and log when items were dropped. */
export function capItemsAndLog<T>(
  items: T[],
  opts: {
    userId?: string | null;
    actionType: AiActionType;
    subAction?: string;
    maxItems: number;
    model?: string;
  },
): T[] {
  if (items.length <= opts.maxItems) return items;
  void logCapHit({
    userId: opts.userId,
    actionType: opts.actionType,
    subAction: opts.subAction ?? null,
    capKind: "context_items",
    capValue: opts.maxItems,
    observedValue: items.length,
    model: opts.model,
  });
  return items.slice(0, opts.maxItems);
}
