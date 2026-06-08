
-- Outcomes: restrict all policies to authenticated
DROP POLICY IF EXISTS outcomes_delete_admin ON public.outcomes;
DROP POLICY IF EXISTS outcomes_delete_personal_owner ON public.outcomes;
DROP POLICY IF EXISTS outcomes_insert_member ON public.outcomes;
DROP POLICY IF EXISTS outcomes_select_member ON public.outcomes;
DROP POLICY IF EXISTS outcomes_select_personal_owner ON public.outcomes;
DROP POLICY IF EXISTS outcomes_update_member ON public.outcomes;
DROP POLICY IF EXISTS outcomes_update_personal_owner ON public.outcomes;

CREATE POLICY outcomes_delete_admin ON public.outcomes FOR DELETE TO authenticated
  USING ((business_id IS NOT NULL) AND (is_member(business_id, 'admin') OR is_platform_admin()));
CREATE POLICY outcomes_delete_personal_owner ON public.outcomes FOR DELETE TO authenticated
  USING ((business_id IS NULL) AND (owner_id = auth.uid()));
CREATE POLICY outcomes_insert_member ON public.outcomes FOR INSERT TO authenticated
  WITH CHECK ((owner_id = auth.uid()) AND (((business_id IS NOT NULL) AND is_member(business_id, 'member')) OR (business_id IS NULL)));
CREATE POLICY outcomes_select_member ON public.outcomes FOR SELECT TO authenticated
  USING ((business_id IS NOT NULL) AND (is_member(business_id, 'viewer') OR is_platform_admin()));
CREATE POLICY outcomes_select_personal_owner ON public.outcomes FOR SELECT TO authenticated
  USING ((business_id IS NULL) AND (owner_id = auth.uid()));
CREATE POLICY outcomes_update_member ON public.outcomes FOR UPDATE TO authenticated
  USING ((business_id IS NOT NULL) AND (is_member(business_id, 'member') OR is_platform_admin()));
CREATE POLICY outcomes_update_personal_owner ON public.outcomes FOR UPDATE TO authenticated
  USING ((business_id IS NULL) AND (owner_id = auth.uid()))
  WITH CHECK ((business_id IS NULL) AND (owner_id = auth.uid()));

-- task_status_history personal policies
DROP POLICY IF EXISTS tsh_insert_personal_owner ON public.task_status_history;
DROP POLICY IF EXISTS tsh_select_personal_owner ON public.task_status_history;

CREATE POLICY tsh_insert_personal_owner ON public.task_status_history FOR INSERT TO authenticated
  WITH CHECK ((business_id IS NULL) AND (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_status_history.task_id AND t.owner_id = auth.uid()
  )));
CREATE POLICY tsh_select_personal_owner ON public.task_status_history FOR SELECT TO authenticated
  USING ((business_id IS NULL) AND (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_status_history.task_id AND t.owner_id = auth.uid()
  )));

-- tasks personal policies
DROP POLICY IF EXISTS tasks_insert_personal_owner ON public.tasks;
DROP POLICY IF EXISTS tasks_select_personal_owner ON public.tasks;
DROP POLICY IF EXISTS tasks_update_personal_owner ON public.tasks;

CREATE POLICY tasks_insert_personal_owner ON public.tasks FOR INSERT TO authenticated
  WITH CHECK ((business_id IS NULL) AND (owner_id = auth.uid()));
CREATE POLICY tasks_select_personal_owner ON public.tasks FOR SELECT TO authenticated
  USING ((business_id IS NULL) AND (owner_id = auth.uid()));
CREATE POLICY tasks_update_personal_owner ON public.tasks FOR UPDATE TO authenticated
  USING ((business_id IS NULL) AND (owner_id = auth.uid()))
  WITH CHECK ((business_id IS NULL) AND (owner_id = auth.uid()));
