-- note_links: connections from a note to tasks, meetings, events, or other notes
CREATE TABLE public.note_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  business_id uuid NOT NULL,
  to_type text NOT NULL CHECK (to_type IN ('task','meeting','event','note')),
  to_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_note_id, to_type, to_id)
);

CREATE INDEX idx_note_links_from ON public.note_links(from_note_id);
CREATE INDEX idx_note_links_to ON public.note_links(to_type, to_id);
CREATE INDEX idx_note_links_business ON public.note_links(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_links TO authenticated;
GRANT ALL ON public.note_links TO service_role;

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;

-- A user can see a link if they can see the source note (member of the
-- business OR tagged on the note). Tag-based access remains view-only.
CREATE POLICY note_links_select ON public.note_links
  FOR SELECT TO authenticated
  USING (
    is_member(business_id, 'viewer'::text)
    OR is_platform_admin()
    OR is_tagged('note'::text, from_note_id)
  );

CREATE POLICY note_links_insert_member ON public.note_links
  FOR INSERT TO authenticated
  WITH CHECK (is_member(business_id, 'member'::text) OR is_platform_admin());

CREATE POLICY note_links_delete_member ON public.note_links
  FOR DELETE TO authenticated
  USING (is_member(business_id, 'member'::text) OR is_platform_admin());