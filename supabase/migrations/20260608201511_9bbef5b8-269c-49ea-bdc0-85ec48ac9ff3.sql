-- 1) Remove client-side INSERT on login_history; writes go through service role.
DROP POLICY IF EXISTS login_history_own_insert ON public.login_history;

-- 2) Tighten note-attachments storage policies to enforce per-note access.
DROP POLICY IF EXISTS note_attachments_storage_select ON storage.objects;
DROP POLICY IF EXISTS note_attachments_storage_update ON storage.objects;
DROP POLICY IF EXISTS note_attachments_storage_delete ON storage.objects;

CREATE POLICY note_attachments_storage_select
ON storage.objects FOR SELECT
USING (
  bucket_id = 'note-attachments'
  AND (
    -- personal user folder
    (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    OR
    -- business folder: must have viewer access on the specific note
    EXISTS (
      SELECT 1 FROM public.note_attachments na
      WHERE na.storage_path = storage.objects.name
        AND public.can_access(auth.uid(), 'note', na.note_id, 'viewer')
    )
  )
);

CREATE POLICY note_attachments_storage_update
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'note-attachments'
  AND (
    (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM public.note_attachments na
      WHERE na.storage_path = storage.objects.name
        AND public.can_access(auth.uid(), 'note', na.note_id, 'member')
    )
  )
);

CREATE POLICY note_attachments_storage_delete
ON storage.objects FOR DELETE
USING (
  bucket_id = 'note-attachments'
  AND (
    (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM public.note_attachments na
      WHERE na.storage_path = storage.objects.name
        AND public.can_access(auth.uid(), 'note', na.note_id, 'member')
    )
  )
);