import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Toggle a business between active and locked (read-only).
 *
 * After a downgrade, all over-limit items are locked. The user picks which
 * stay active by activating them — the DB function rejects activation past
 * the plan cap so the user must lock another first. Locked items become
 * editable again automatically on re-upgrade (webhook clears all locks).
 */
export const setBusinessActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), active: z.boolean() }).parse)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("set_business_active", {
      _id: data.id,
      _active: data.active,
    });
    if (error) {
      if (/UPGRADE_REQUIRED/.test(error.message)) {
        throw new Error(
          "You've reached your plan's active limit. Lock another business first or upgrade.",
        );
      }
      throw new Error(error.message);
    }
    return row;
  });

/** Toggle a calendar connection between active and locked (read-only). */
export const setCalendarActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), active: z.boolean() }).parse)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("set_calendar_active", {
      _id: data.id,
      _active: data.active,
    });
    if (error) {
      if (/UPGRADE_REQUIRED/.test(error.message)) {
        throw new Error(
          "You've reached your plan's active calendar limit. Lock another first or upgrade.",
        );
      }
      throw new Error(error.message);
    }
    return row;
  });
