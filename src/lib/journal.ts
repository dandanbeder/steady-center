import { supabase } from "@/integrations/supabase/client";

export type JournalMeta = {
  note_id: string;
  owner_id: string;
  mood: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export const MOOD_LABELS: Record<number, string> = {
  1: "Heavy",
  2: "Low",
  3: "Even",
  4: "Bright",
  5: "Light",
};

export const REFLECTION_PROMPTS: { id: string; label: string; body: string }[] = [
  {
    id: "well",
    label: "What went well today?",
    body: "## What went well today\n- \n\n## Why it mattered\n- \n",
  },
  {
    id: "mind",
    label: "What's on your mind?",
    body: "## What's on my mind\n- \n\n## What I want to set down\n- \n",
  },
  {
    id: "grateful",
    label: "What am I grateful for?",
    body: "## Three small things I'm grateful for\n1. \n2. \n3. \n",
  },
  {
    id: "kind",
    label: "A kind word to myself",
    body: "## A kind word to myself\n- \n",
  },
];

export async function listJournalMeta(): Promise<JournalMeta[]> {
  const { data, error } = await (supabase.from("journal_meta" as never) as never as {
    select: (s: string) => Promise<{ data: JournalMeta[] | null; error: unknown }>;
  }).select("*");
  if (error) throw error as Error;
  return (data ?? []) as JournalMeta[];
}

export async function upsertJournalMeta(input: {
  note_id: string;
  mood: number | null;
  tags: string[];
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const payload = {
    note_id: input.note_id,
    owner_id: u.user.id,
    mood: input.mood,
    tags: input.tags,
  };
  const { error } = await (supabase.from("journal_meta" as never) as never as {
    upsert: (v: unknown, opts?: unknown) => Promise<{ error: unknown }>;
  }).upsert(payload, { onConflict: "note_id" });
  if (error) throw error as Error;
}
