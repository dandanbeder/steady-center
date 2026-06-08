import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type SharedRow = {
  tag_id: string;
  item_type: "task" | "note" | "event";
  item_id: string;
  business_id: string;
  business_name: string;
  title: string;
  subtitle: string | null;
  created_at: string;
};

/**
 * Returns every item the signed-in user is tagged on, across spaces.
 * Uses admin client to bypass RLS (we explicitly scope to auth.uid()).
 */
export const listSharedWithMe = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<SharedRow[]> => {
    const { userId } = context;
    const { data: tags, error } = await supabaseAdmin
      .from("item_tags")
      .select("id, item_type, item_id, business_id, created_at")
      .eq("tagged_user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!tags || tags.length === 0) return [];

    const bizIds = [...new Set(tags.map((t) => t.business_id))];
    const taskIds = tags.filter((t) => t.item_type === "task").map((t) => t.item_id);
    const noteIds = tags.filter((t) => t.item_type === "note").map((t) => t.item_id);
    const eventIds = tags.filter((t) => t.item_type === "event").map((t) => t.item_id);

    const [{ data: bizes }, { data: tasks }, { data: notes }, { data: events }] =
      await Promise.all([
        supabaseAdmin.from("businesses").select("id, name").in("id", bizIds),
        taskIds.length
          ? supabaseAdmin.from("tasks").select("id, title, status, due_at").is("deleted_at", null).in("id", taskIds)
          : Promise.resolve({ data: [] as { id: string; title: string; status: string; due_at: string | null }[] }),
        noteIds.length
          ? supabaseAdmin.from("notes").select("id, title, body").is("deleted_at", null).in("id", noteIds)
          : Promise.resolve({ data: [] as { id: string; title: string; body: string }[] }),
        eventIds.length
          ? supabaseAdmin.from("events").select("id, title, start_at, location").is("deleted_at", null).in("id", eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string; start_at: string; location: string | null }[] }),
      ]);

    const bizName = new Map((bizes ?? []).map((b) => [b.id, b.name]));
    const taskMap = new Map((tasks ?? []).map((t) => [t.id, t]));
    const noteMap = new Map((notes ?? []).map((n) => [n.id, n]));
    const eventMap = new Map((events ?? []).map((e) => [e.id, e]));

    return tags
      .map((t): SharedRow | null => {
        const business_name = bizName.get(t.business_id) ?? "Unknown space";
        if (t.item_type === "task") {
          const x = taskMap.get(t.item_id);
          if (!x) return null;
          return {
            tag_id: t.id,
            item_type: "task",
            item_id: t.item_id,
            business_id: t.business_id,
            business_name,
            title: x.title,
            subtitle: x.due_at ? `Due ${new Date(x.due_at).toLocaleDateString()}` : x.status,
            created_at: t.created_at,
          };
        }
        if (t.item_type === "note") {
          const x = noteMap.get(t.item_id);
          if (!x) return null;
          return {
            tag_id: t.id,
            item_type: "note",
            item_id: t.item_id,
            business_id: t.business_id,
            business_name,
            title: x.title || "Untitled",
            subtitle: x.body ? x.body.slice(0, 100) : null,
            created_at: t.created_at,
          };
        }
        const x = eventMap.get(t.item_id);
        if (!x) return null;
        return {
          tag_id: t.id,
          item_type: "event",
          item_id: t.item_id,
          business_id: t.business_id,
          business_name,
          title: x.title,
          subtitle: `${new Date(x.start_at).toLocaleString()}${x.location ? ` · ${x.location}` : ""}`,
          created_at: t.created_at,
        };
      })
      .filter((r): r is SharedRow => r !== null);
  });

/**
 * Fires on sign-in. Finds unnotified tags for this user and sends one
 * digest email. Idempotent via notified_at.
 */
export const notifyClaimedTags = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = u.user?.email;
    if (!email) return { ok: true, notified: 0 };

    const { data: pending } = await supabaseAdmin
      .from("item_tags")
      .select("id, item_type, business_id")
      .eq("tagged_user_id", userId)
      .is("notified_at", null);
    if (!pending || pending.length === 0) return { ok: true, notified: 0 };

    const bizIds = [...new Set(pending.map((t) => t.business_id))];
    const { data: bizes } = await supabaseAdmin
      .from("businesses")
      .select("id, name")
      .in("id", bizIds);
    const bizName = new Map((bizes ?? []).map((b) => [b.id, b.name]));

    const counts = { task: 0, note: 0, event: 0 } as Record<string, number>;
    pending.forEach((p) => {
      counts[p.item_type] = (counts[p.item_type] ?? 0) + 1;
    });

    const origin =
      process.env.PUBLIC_APP_URL ||
      process.env.VITE_PUBLIC_APP_URL ||
      "https://steady-center.lovable.app";

    const apiKey = process.env.LOVABLE_API_KEY;
    const conn = process.env.RESEND_API_KEY;
    if (apiKey && conn) {
      const escapeHtml = (s: string) =>
        s.replace(/[&<>"']/g, (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
        );
      const spaces = bizIds
        .map((id) => escapeHtml(bizName.get(id) ?? "a space"))
        .join(", ");
      const parts: string[] = [];
      if (counts.task) parts.push(`${counts.task} task${counts.task > 1 ? "s" : ""}`);
      if (counts.note) parts.push(`${counts.note} note${counts.note > 1 ? "s" : ""}`);
      if (counts.event) parts.push(`${counts.event} event${counts.event > 1 ? "s" : ""}`);
      const html = `<p>You've been tagged on ${escapeHtml(parts.join(", "))} across ${spaces}.</p>
        <p><a href="${origin}/shared">Open Shared with me</a></p>`;
      await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Connection-Api-Key": conn,
        },
        body: JSON.stringify({
          from: "Heartbeat <noreply@flightmed.software>",
          to: [email],
          subject: "You've been tagged on Heartbeat",
          html,
        }),
      }).catch((e) => console.error("[item-tags] notify failed", e));
    }

    await supabaseAdmin
      .from("item_tags")
      .update({ notified_at: new Date().toISOString() })
      .in("id", pending.map((p) => p.id));

    return { ok: true, notified: pending.length };
  });

/** Suggest member emails for autocomplete in tag input. */
export const suggestMemberEmails = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: mems } = await supabaseAdmin
      .from("memberships")
      .select("business_id")
      .eq("user_id", userId)
      .eq("status", "active");
    const bizIds = (mems ?? []).map((m) => m.business_id);
    if (bizIds.length === 0) return [] as { email: string; name: string | null }[];

    const { data: others } = await supabaseAdmin
      .from("memberships")
      .select("user_id")
      .in("business_id", bizIds)
      .eq("status", "active");
    const userIds = [...new Set((others ?? []).map((m) => m.user_id).filter(Boolean) as string[])];
    if (userIds.length === 0) return [];

    const [{ data: profs }, authList] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds),
      Promise.all(
        userIds.map((id) => supabaseAdmin.auth.admin.getUserById(id).then((r) => r.data.user)),
      ),
    ]);
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    return authList
      .filter((u): u is NonNullable<typeof u> => Boolean(u?.email))
      .map((u) => ({
        email: u.email!.toLowerCase(),
        name: nameById.get(u.id) ?? null,
      }));
  });
