
-- 1) Restrict action_items personal policies to authenticated role
DROP POLICY IF EXISTS action_items_select_owner_personal ON public.action_items;
DROP POLICY IF EXISTS action_items_insert_owner_personal ON public.action_items;
DROP POLICY IF EXISTS action_items_update_owner_personal ON public.action_items;
DROP POLICY IF EXISTS action_items_delete_owner_personal ON public.action_items;

CREATE POLICY action_items_select_owner_personal ON public.action_items
  FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY action_items_insert_owner_personal ON public.action_items
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY action_items_update_owner_personal ON public.action_items
  FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY action_items_delete_owner_personal ON public.action_items
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

-- 2) Add explicit public SELECT policy on account-logos bucket objects
DROP POLICY IF EXISTS "Public read account logos" ON storage.objects;
CREATE POLICY "Public read account logos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'account-logos');
