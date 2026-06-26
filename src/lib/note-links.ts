import { supabase } from "@/integrations/supabase/client";

export type NoteLinkType = "task" | "meeting" | "event" | "note" | "outcome";

export type NoteLink = {
  id: string;
  from_note_id: string;
  business_id: string;
  to_type: NoteLinkType;
  to_id: string;
  created_by: string | null;
  created_at: string;
};

export type ResolvedLink = NoteLink & {
  label: string;
  href?: string;
};

export async function listLinksFrom(noteId: string): Promise<NoteLink[]> {
  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .eq("from_note_id", noteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as NoteLink[];
}

export async function listBacklinks(toType: NoteLinkType, toId: string): Promise<NoteLink[]> {
  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .eq("to_type", toType)
    .eq("to_id", toId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as NoteLink[];
}

export async function createLink(input: {
  from_note_id: string;
  business_id: string;
  to_type: NoteLinkType;
  to_id: string;
}) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("note_links").insert({
    from_note_id: input.from_note_id,
    business_id: input.business_id,
    to_type: input.to_type,
    to_id: input.to_id,
    created_by: u.user?.id ?? null,
  });
  if (error && !/duplicate/i.test(error.message)) throw error;
}

export async function deleteLink(id: string) {
  const { error } = await supabase.from("note_links").delete().eq("id", id);
  if (error) throw error;
}

/** Resolve link targets to a readable label, batched per type. */
export async function resolveLinks(links: NoteLink[]): Promise<ResolvedLink[]> {
  const byType: Record<NoteLinkType, string[]> = { task: [], meeting: [], event: [], note: [], outcome: [] };
  for (const l of links) byType[l.to_type].push(l.to_id);

  const labels = new Map<string, { label: string; href?: string }>();

  if (byType.task.length) {
    const { data } = await supabase.from("tasks").select("id,title").is("deleted_at", null).in("id", byType.task);
    for (const t of (data ?? []) as Array<{ id: string; title: string }>) {
      labels.set(`task:${t.id}`, { label: t.title, href: `/tasks` });
    }
  }
  if (byType.meeting.length) {
    const { data } = await supabase.from("meetings").select("id,title").in("id", byType.meeting);
    for (const m of (data ?? []) as Array<{ id: string; title: string }>) {
      labels.set(`meeting:${m.id}`, { label: m.title, href: `/meetings/${m.id}` });
    }
  }
  if (byType.event.length) {
    const { data } = await supabase.from("events").select("id,title,start_at").is("deleted_at", null).in("id", byType.event);
    for (const e of (data ?? []) as Array<{ id: string; title: string; start_at: string }>) {
      labels.set(`event:${e.id}`, { label: e.title, href: `/calendar` });
    }
  }
  if (byType.note.length) {
    const { data } = await supabase.from("notes").select("id,title").is("deleted_at", null).in("id", byType.note);
    for (const n of (data ?? []) as Array<{ id: string; title: string }>) {
      labels.set(`note:${n.id}`, { label: n.title || "Untitled", href: `/notes` });
  }
  if (byType.outcome.length) {
    const { data } = await supabase.from("outcomes").select("id,name").in("id", byType.outcome);
    for (const o of (data ?? []) as Array<{ id: string; name: string }>) {
      labels.set(`outcome:${o.id}`, { label: o.name || "Untitled outcome", href: `/outcomes` });
    }
  }


  return links.map((l) => {
    const meta = labels.get(`${l.to_type}:${l.to_id}`);
    return {
      ...l,
      label: meta?.label ?? "(no access)",
      href: meta?.href,
    };
  });
}
