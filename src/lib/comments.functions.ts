import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const PARENT = z.enum(["task", "note", "event", "meeting"]);
const ParentInput = z.object({
  parent_type: PARENT,
  parent_id: z.string().uuid(),
});

export const listComments = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => ParentInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("comments")
      .select(
        "id, parent_type, parent_id, business_id, parent_owner_id, author_id, body, created_at, edited_at, deleted_at",
      )
      .eq("parent_type", data.parent_type)
      .eq("parent_id", data.parent_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const authorIds = Array.from(new Set(list.map((c) => c.author_id)));
    const commentIds = list.map((c) => c.id);

    const [profilesRes, mentionsRes] = await Promise.all([
      authorIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", authorIds)
        : Promise.resolve({ data: [], error: null } as const),
      commentIds.length
        ? supabase
            .from("comment_mentions")
            .select("comment_id, mentioned_user_id")
            .in("comment_id", commentIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (mentionsRes.error) throw new Error(mentionsRes.error.message);

    const profileMap = new Map<string, { full_name: string | null }>(
      (profilesRes.data ?? []).map(
        (p: { id: string; full_name: string | null }) => [p.id, { full_name: p.full_name }],
      ),
    );
    const mentionsByComment = new Map<string, { mentioned_user_id: string }[]>();
    for (const m of mentionsRes.data ?? []) {
      const row = m as { comment_id: string; mentioned_user_id: string };
      const arr = mentionsByComment.get(row.comment_id) ?? [];
      arr.push({ mentioned_user_id: row.mentioned_user_id });
      mentionsByComment.set(row.comment_id, arr);
    }
    return list.map((c) => {
      const p = profileMap.get(c.author_id);
      return {
        ...c,
        author_name: p?.full_name ?? null,
        author_avatar: null as string | null,
        mentions: mentionsByComment.get(c.id) ?? [],
      };
    });
  });


export const addComment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    ParentInput.extend({ body: z.string().trim().min(1).max(8000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("comments")
      .insert({
        parent_type: data.parent_type,
        parent_id: data.parent_id,
        author_id: userId,
        body: data.body,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const editComment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) =>
    z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(8000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("comments")
      .update({ body: data.body })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Returns mention candidates (members of the parent's account + people tagged on the item). */
export const suggestMentionTargets = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((i) => ParentInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Find parent's business_id
    let businessId: string | null = null;
    let ownerId: string | null = null;
    if (data.parent_type === "task") {
      const { data: r } = await supabase
        .from("tasks").select("business_id, owner_id").eq("id", data.parent_id).maybeSingle();
      businessId = r?.business_id ?? null; ownerId = r?.owner_id ?? null;
    } else if (data.parent_type === "note") {
      const { data: r } = await supabase
        .from("notes").select("business_id, owner_id").eq("id", data.parent_id).maybeSingle();
      businessId = r?.business_id ?? null; ownerId = r?.owner_id ?? null;
    } else if (data.parent_type === "event") {
      const { data: r } = await supabase
        .from("events").select("business_id, owner_id").eq("id", data.parent_id).maybeSingle();
      businessId = r?.business_id ?? null; ownerId = r?.owner_id ?? null;
    } else if (data.parent_type === "meeting") {
      const { data: r } = await supabase
        .from("meetings").select("business_id, owner_id").eq("id", data.parent_id).maybeSingle();
      businessId = r?.business_id ?? null; ownerId = r?.owner_id ?? null;
    }

    const candidates = new Map<string, { id: string; name: string; email: string | null }>();

    if (businessId) {
      const { data: members, error } = await supabase.rpc("list_business_members", {
        p_business: businessId,
      });
      if (!error) {
        for (const m of (members ?? []) as Array<{
          user_id: string | null;
          full_name: string | null;
          email: string | null;
          status: string;
        }>) {
          if (m.status !== "active" || !m.user_id) continue;
          candidates.set(m.user_id, {
            id: m.user_id,
            name: m.full_name ?? m.email ?? "Unknown",
            email: m.email ?? null,
          });
        }
      }
    } else if (ownerId) {
      const { data: owner } = await supabase
        .from("profiles").select("id, full_name").eq("id", ownerId).maybeSingle();
      if (owner) {
        candidates.set(owner.id, { id: owner.id, name: owner.full_name ?? "You", email: null });
      }
    }

    // Also include people tagged on this item who have an account
    const { data: tags } = await supabase
      .from("item_tags")
      .select("tagged_user_id, tagged_email")
      .eq("item_type", data.parent_type)
      .eq("item_id", data.parent_id);
    const taggedUserIds = (tags ?? [])
      .map((t) => t.tagged_user_id)
      .filter((v): v is string => !!v)
      .filter((id) => !candidates.has(id));
    if (taggedUserIds.length) {
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name").in("id", taggedUserIds);
      for (const p of profs ?? []) {
        candidates.set(p.id, { id: p.id, name: p.full_name ?? "Unknown", email: null });
      }
    }

    return Array.from(candidates.values()).sort((a, b) => a.name.localeCompare(b.name));
  });
