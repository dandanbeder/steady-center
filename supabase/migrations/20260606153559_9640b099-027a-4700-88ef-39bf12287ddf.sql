
-- 1) Restrict realtime broadcast on the `subscriptions:{user_id}` topic to the owning user
DROP POLICY IF EXISTS "Users read own subscription realtime" ON realtime.messages;
CREATE POLICY "Users read own subscription realtime"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'subscriptions:' || (SELECT auth.uid())::text
  );

-- 2) Owner policies for personal (business_id IS NULL) weekly_reports
DROP POLICY IF EXISTS weekly_reports_select_personal ON public.weekly_reports;
CREATE POLICY weekly_reports_select_personal
  ON public.weekly_reports FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

DROP POLICY IF EXISTS weekly_reports_insert_personal ON public.weekly_reports;
CREATE POLICY weekly_reports_insert_personal
  ON public.weekly_reports FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

DROP POLICY IF EXISTS weekly_reports_update_personal ON public.weekly_reports;
CREATE POLICY weekly_reports_update_personal
  ON public.weekly_reports FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

DROP POLICY IF EXISTS weekly_reports_delete_personal ON public.weekly_reports;
CREATE POLICY weekly_reports_delete_personal
  ON public.weekly_reports FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());
