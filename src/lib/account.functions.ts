import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AUDIO_BUCKET = "meeting-audio";
const ATTACHMENT_BUCKET = "note-attachments";
const LOGO_BUCKET = "account-logos";

/** Recursively list all files under a storage prefix and return their full paths. */
async function listAllPaths(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data: entries, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error || !entries) return out;
  for (const e of entries) {
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    // Folders have no id/metadata in Supabase storage list
    if (e.id) {
      out.push(full);
    } else {
      const nested = await listAllPaths(bucket, full);
      out.push(...nested);
    }
  }
  return out;
}

async function removeAll(bucket: string, paths: string[]) {
  if (paths.length === 0) return;
  // Chunk to stay within request limits
  for (let i = 0; i < paths.length; i += 500) {
    await supabaseAdmin.storage.from(bucket).remove(paths.slice(i, i + 500));
  }
}

async function deleteUserAudio(userId: string) {
  const paths = await listAllPaths(AUDIO_BUCKET, userId);
  await removeAll(AUDIO_BUCKET, paths);
}

/** Delete every note attachment file linked to notes owned (or created) by the user. */
async function deleteUserNoteAttachments(userId: string) {
  // Notes the user owns
  const { data: ownedNotes } = await supabaseAdmin
    .from("notes")
    .select("id")
    .eq("owner_id", userId);
  const ownedIds = (ownedNotes ?? []).map((n: { id: string }) => n.id);

  const paths = new Set<string>();
  if (ownedIds.length > 0) {
    const { data: atts1 } = await supabaseAdmin
      .from("note_attachments")
      .select("storage_path")
      .in("note_id", ownedIds);
    for (const a of atts1 ?? []) if (a.storage_path) paths.add(a.storage_path);
  }
  // Attachments the user uploaded inside other people's notes
  const { data: atts2 } = await supabaseAdmin
    .from("note_attachments")
    .select("storage_path")
    .eq("created_by", userId);
  for (const a of atts2 ?? []) if (a.storage_path) paths.add(a.storage_path);

  await removeAll(ATTACHMENT_BUCKET, [...paths]);
}

async function deleteBusinessAudio(userId: string, businessId: string) {
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
    await supabaseAdmin.storage.from(AUDIO_BUCKET).remove(paths);
  }
}

/** Delete attachment files for every note belonging to a business. */
async function deleteBusinessAttachments(businessId: string) {
  const { data: atts } = await supabaseAdmin
    .from("note_attachments")
    .select("storage_path")
    .eq("business_id", businessId);
  const paths = (atts ?? [])
    .map((a: { storage_path: string | null }) => a.storage_path)
    .filter((p): p is string => !!p);
  await removeAll(ATTACHMENT_BUCKET, paths);
}

/** Delete all logo files under a business's storage prefix. */
async function deleteBusinessLogos(businessId: string) {
  const paths = await listAllPaths(LOGO_BUCKET, businessId);
  await removeAll(LOGO_BUCKET, paths);
}

/** Delete a business + all its child data (DB cascade) and its storage files. */
export const deleteBusinessCascade = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => z.object({ business_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await deleteBusinessAudio(userId, data.business_id);
    await deleteBusinessAttachments(data.business_id);
    await deleteBusinessLogos(data.business_id);
    // RLS on businesses scopes to owner, DB FKs cascade the rest.
    const { error } = await supabase.from("businesses").delete().eq("id", data.business_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete one meeting's stored recording, clear audio_path + keep_recording. */
export const deleteMeetingRecording = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => z.object({ meeting_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: m, error: rErr } = await supabase
      .from("meetings")
      .select("id, audio_path")
      .eq("id", data.meeting_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!m) throw new Error("Not found");
    if (m.audio_path && m.audio_path.startsWith(`${userId}/`)) {
      await supabaseAdmin.storage.from(AUDIO_BUCKET).remove([m.audio_path]);
    }
    const { error: uErr } = await supabase
      .from("meetings")
      .update({ audio_path: null, keep_recording: false })
      .eq("id", data.meeting_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

/** Permanently delete the signed-in user, all owned rows, and all storage files (POPIA s24). */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) =>
    z.object({ confirm: z.literal("DELETE") }).parse(input),
  )
  .handler(async ({ context }) => {
    const { userId } = context;

    // 1. Wipe storage objects owned by the user BEFORE deleting their DB rows,
    //    so we still have paths to look up. Also wipe logos for businesses they own.
    await deleteUserNoteAttachments(userId);
    await deleteUserAudio(userId);
    const { data: ownedBiz } = await supabaseAdmin
      .from("businesses").select("id").eq("owner_id", userId);
    for (const b of ownedBiz ?? []) {
      await deleteBusinessLogos((b as { id: string }).id);
    }

    // 2. Delete cross-user link rows where this user is the target/author.
    await supabaseAdmin.from("item_tags").delete().eq("created_by", userId);
    await supabaseAdmin.from("item_tags").delete().eq("tagged_user_id", userId);
    await supabaseAdmin.from("comment_mentions").delete().eq("mentioned_user_id", userId);
    await supabaseAdmin.from("comments").delete().eq("author_id", userId);
    await supabaseAdmin.from("shares").delete().eq("grantee_user_id", userId);
    await supabaseAdmin.from("shares").delete().eq("granted_by", userId);
    await supabaseAdmin.from("access_requests").delete().eq("requester_user_id", userId);

    // 3. Delete all rows keyed by owner_id. Order matters where no FK cascade exists.
    //    Businesses cascade most child tables; we also clean rows where business_id is null.
    const ownerTables = [
      "daily_pulses",
      "weekly_reports",
      "inbox_items",
      "reminders",
      "action_items",
      "outcomes",
      "meetings",
      "notes",
      "tasks",
      "lists",
      "folders",
      "events",
      "calendars",
      "businesses",
    ] as const;
    for (const t of ownerTables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("owner_id", userId);
      if (error) throw new Error(`${t}: ${error.message}`);
    }

    // Templates have no owner_id, scope by created_by.
    await supabaseAdmin.from("templates").delete().eq("created_by", userId);

    // 4. Delete all rows keyed by user_id.
    const userTables = [
      "ai_prefs",
      "ai_usage",
      "assistant_actions",
      "login_history",
      "memberships",
      "notification_prefs",
      "notifications",
      "time_entries",
      "weekly_goals",
      "email_unsubscribe_tokens",
      "announcement_dismissals",
      "user_entitlement_overrides",
      "ms_oauth_tokens",
      "ms_subscriptions",
      "subscriptions",
    ] as const;
    for (const t of userTables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", userId);
      if (error) throw new Error(`${t}: ${error.message}`);
    }

    // 5. Profile + auth user
    await supabaseAdmin.from("profiles").delete().eq("id", userId);
    const { error: dErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (dErr) throw new Error(dErr.message);
    return { ok: true };
  });
