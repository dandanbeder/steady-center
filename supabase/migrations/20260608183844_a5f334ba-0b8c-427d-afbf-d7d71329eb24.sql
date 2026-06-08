-- 1) Lock meetings down to owner-only (plus platform admin). Drop the
--    business-member-wide SELECT/UPDATE/DELETE policies so meetings are
--    private by default, matching the comments/realtime model already
--    enforced for meeting parents.
DROP POLICY IF EXISTS meetings_select_member ON public.meetings;
DROP POLICY IF EXISTS meetings_update_member ON public.meetings;
DROP POLICY IF EXISTS meetings_delete_admin ON public.meetings;
DROP POLICY IF EXISTS meetings_insert_member ON public.meetings;
DROP POLICY IF EXISTS meetings_select_personal_owner ON public.meetings;
DROP POLICY IF EXISTS meetings_insert_personal_owner ON public.meetings;
DROP POLICY IF EXISTS meetings_update_personal_owner ON public.meetings;
DROP POLICY IF EXISTS meetings_delete_personal_owner ON public.meetings;

CREATE POLICY meetings_select_owner ON public.meetings
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY meetings_insert_owner ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY meetings_update_owner ON public.meetings
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY meetings_delete_owner ON public.meetings
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_platform_admin());

-- 2) Extend note-attachments storage policies to cover personal-note
--    paths under "user-<uuid>/..." so attachments are reachable for
--    notes that don't belong to a business. Existing business paths
--    keep working.
DROP POLICY IF EXISTS note_attachments_storage_select ON storage.objects;
DROP POLICY IF EXISTS note_attachments_storage_insert ON storage.objects;
DROP POLICY IF EXISTS note_attachments_storage_update ON storage.objects;
DROP POLICY IF EXISTS note_attachments_storage_delete ON storage.objects;

CREATE POLICY note_attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND (
      (
        (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_member(((storage.foldername(name))[1])::uuid, 'viewer')
      )
      OR (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    )
  );

CREATE POLICY note_attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-attachments'
    AND (
      (
        (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
      )
      OR (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    )
  );

CREATE POLICY note_attachments_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND (
      (
        (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
      )
      OR (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    )
  );

CREATE POLICY note_attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-attachments'
    AND (
      (
        (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_member(((storage.foldername(name))[1])::uuid, 'member')
      )
      OR (storage.foldername(name))[1] = ('user-' || auth.uid()::text)
    )
  );