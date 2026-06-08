import { supabase } from "@/integrations/supabase/client";

export type CommentParentType = "task" | "note" | "event" | "meeting";

export type CommentRow = {
  id: string;
  parent_type: CommentParentType;
  parent_id: string;
  business_id: string | null;
  parent_owner_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type CommentWithAuthor = CommentRow & {
  author_name: string | null;
  author_avatar: string | null;
  mentions: { mentioned_user_id: string }[];
};

/** Subscribe to comment changes for a given parent item. Returns an unsubscribe fn. */
export function subscribeToComments(
  parent_type: CommentParentType,
  parent_id: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`comments:${parent_type}:${parent_id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `parent_id=eq.${parent_id}`,
      },
      () => onChange(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Parse @[Name](uuid) markers from a comment body and return tokenised parts. */
export type BodyPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; name: string };

export function parseBody(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  const re = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push({ kind: "text", text: body.slice(last, m.index) });
    parts.push({ kind: "mention", userId: m[2], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}

/** Human-friendly relative time. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
