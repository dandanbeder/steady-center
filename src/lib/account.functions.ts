import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "meeting-audio";

async function deleteUserAudio(userId: string) {
  // List every object under <userId>/ and remove. Storage is folder-scoped per owner.
  const { data: objs, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });
  if (error) return; // bucket empty or no folder is fine
  const paths = (objs ?? []).map((o) => `${userId}/${o.name}`);
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths);
  }
}

async function deleteBusinessAudio(userId: string, businessId: string) {
  // Find all meeting audio paths for that business owned by user, delete files first.
  const { data: meetings } = await supabaseAdmin
    .from("meetings")
    .select("audio_path")
    .eq("owner_id", userId)
    .eq("business_id", businessId)
    .not("audio_path", "is", null);
  const paths = (meetings ?? [])
    .map((m: { audio_path: string | null }) => m.audio_path)
    .filter((p): p is string => !!p && p.startsWith(`${userId}/`));
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths);
  }
}

/** Delete a business + all its child data (DB cascade) and its storage files. */
export const deleteBusinessCascade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ business_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await deleteBusinessAudio(userId, data.business_id);
    // RLS on businesses scopes to owner — DB FKs cascade the rest.
    const { error } = await supabase.from("businesses").delete().eq("id", data.business_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete one meeting's stored recording, clear audio_path + keep_recording. */
export const deleteMeetingRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ meeting_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS-scoped read
    const { data: m, error: rErr } = await supabase
      .from("meetings")
      .select("id, audio_path")
      .eq("id", data.meeting_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!m) throw new Error("Not found");
    if (m.audio_path && m.audio_path.startsWith(`${userId}/`)) {
      await supabaseAdmin.storage.from(BUCKET).remove([m.audio_path]);
    }
    const { error: uErr } = await supabase
      .from("meetings")
      .update({ audio_path: null, keep_recording: false })
      .eq("id", data.meeting_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

/** Permanently delete the signed-in user, all owned rows, and all storage files. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ confirm: z.literal("DELETE") }).parse(input),
  )
  .handler(async ({ context }) => {
    const { userId } = context;
    // 1. Wipe all storage objects under userId/
    await deleteUserAudio(userId);
    // 2. Delete all owned rows. Order matters where no FK cascade exists.
    //    Businesses cascade most child tables; we also clean rows where business_id is null.
    const tables = [
      "weekly_reports",
      "reminders",
      "action_items",
      "meetings",
      "notes",
      "tasks",
      "lists",
      "folders",
      "events",
      "calendars",
      "businesses",
    ] as const;
    for (const t of tables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("owner_id", userId);
      if (error) throw new Error(`${t}: ${error.message}`);
    }
    await supabaseAdmin.from("profiles").delete().eq("id", userId);
    // 3. Delete auth user
    const { error: dErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (dErr) throw new Error(dErr.message);
    return { ok: true };
  });
