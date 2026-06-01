
-- 1. Extend notes
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS note_type text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_meeting_id uuid,
  ADD COLUMN IF NOT EXISTS linked_event_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_note_type_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_note_type_check
  CHECK (note_type IN ('note','journal','meeting','project','decision'));

DROP TRIGGER IF EXISTS notes_touch_updated_at ON public.notes;
CREATE TRIGGER notes_touch_updated_at
BEFORE UPDATE ON public.notes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Attachments table
CREATE TABLE IF NOT EXISTS public.note_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  business_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  extracted_text text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_attachments_note_id_idx ON public.note_attachments(note_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_attachments TO authenticated;
GRANT ALL ON public.note_attachments TO service_role;

ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_attachments_select ON public.note_attachments;
CREATE POLICY note_attachments_select ON public.note_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id, 'viewer')
    OR public.is_platform_admin()
    OR public.is_tagged('note', note_id)
  );

DROP POLICY IF EXISTS note_attachments_insert ON public.note_attachments;
CREATE POLICY note_attachments_insert ON public.note_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member(business_id, 'member') OR public.is_platform_admin());

DROP POLICY IF EXISTS note_attachments_update ON public.note_attachments;
CREATE POLICY note_attachments_update ON public.note_attachments
  FOR UPDATE TO authenticated
  USING (public.is_member(business_id, 'member') OR public.is_platform_admin())
  WITH CHECK (public.is_member(business_id, 'member') OR public.is_platform_admin());

DROP POLICY IF EXISTS note_attachments_delete ON public.note_attachments;
CREATE POLICY note_attachments_delete ON public.note_attachments
  FOR DELETE TO authenticated
  USING (public.is_member(business_id, 'member') OR public.is_platform_admin());

-- 3. Private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('note-attachments', 'note-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (path format: {business_id}/{note_id}/{filename})
DROP POLICY IF EXISTS note_attachments_storage_select ON storage.objects;
CREATE POLICY note_attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'viewer')
  );

DROP POLICY IF EXISTS note_attachments_storage_insert ON storage.objects;
CREATE POLICY note_attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-attachments'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );

DROP POLICY IF EXISTS note_attachments_storage_update ON storage.objects;
CREATE POLICY note_attachments_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );

DROP POLICY IF EXISTS note_attachments_storage_delete ON storage.objects;
CREATE POLICY note_attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );
