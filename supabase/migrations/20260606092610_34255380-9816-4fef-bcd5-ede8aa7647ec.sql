
-- 1. action_items: owner-scoped policies for personal (null business_id) rows
CREATE POLICY "action_items_select_owner_personal" ON public.action_items
  FOR SELECT USING (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "action_items_insert_owner_personal" ON public.action_items
  FOR INSERT WITH CHECK (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "action_items_update_owner_personal" ON public.action_items
  FOR UPDATE USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "action_items_delete_owner_personal" ON public.action_items
  FOR DELETE USING (business_id IS NULL AND owner_id = auth.uid());

-- 2. profiles: prevent privilege escalation via platform_role updates
CREATE OR REPLACE FUNCTION public.prevent_platform_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role THEN
    -- Only the service_role connection (used by trusted admin server fns) may change platform_role
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'platform_role can only be changed by trusted server operations';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_platform_role_change_trg ON public.profiles;
CREATE TRIGGER prevent_platform_role_change_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_role_change();

-- 3. Realtime authorization: restrict notifications channel subscriptions to the owning user
DROP POLICY IF EXISTS "Users read own notification realtime" ON realtime.messages;
CREATE POLICY "Users read own notification realtime"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'notifications:' || (SELECT auth.uid())::text
  );

-- 4. account-logos bucket: remove broad listing policy. Public URLs still work via the public CDN endpoint.
DROP POLICY IF EXISTS "Public read account logos" ON storage.objects;

-- 5. Revoke EXECUTE on internal SECURITY DEFINER trigger functions from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.businesses_seed_default_calendar() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_item_tag() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_access_request() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_meeting_summary() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_weekly_report() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_reminder_sent() FROM anon, authenticated, PUBLIC;
