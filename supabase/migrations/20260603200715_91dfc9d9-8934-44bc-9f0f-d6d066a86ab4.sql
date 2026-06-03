
-- 1. Fix privilege escalation on profiles
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND platform_role IS NOT DISTINCT FROM (
      SELECT platform_role FROM public.profiles WHERE id = auth.uid()
    )
  );

-- 2. Personal events (NULL business_id) - owner access
CREATE POLICY events_select_personal_owner ON public.events
  FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY events_insert_personal_owner ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY events_update_personal_owner ON public.events
  FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY events_delete_personal_owner ON public.events
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

-- 3. Personal meetings (NULL business_id) - owner access
CREATE POLICY meetings_select_personal_owner ON public.meetings
  FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY meetings_insert_personal_owner ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY meetings_update_personal_owner ON public.meetings
  FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY meetings_delete_personal_owner ON public.meetings
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

-- 4. Explicit public SELECT on account-logos bucket
CREATE POLICY "Public read account logos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'account-logos');

-- 5. Owner UPDATE policy on meeting-audio
CREATE POLICY "Owner update meeting audio" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'meeting-audio' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'meeting-audio' AND (auth.uid())::text = (storage.foldername(name))[1]);
