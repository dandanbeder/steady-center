
-- Personal-scoped policies for tasks (business_id IS NULL)
CREATE POLICY tasks_select_personal_owner ON public.tasks
  FOR SELECT USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY tasks_insert_personal_owner ON public.tasks
  FOR INSERT WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY tasks_update_personal_owner ON public.tasks
  FOR UPDATE USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

-- Personal-scoped policies for task_status_history (business_id IS NULL)
CREATE POLICY tsh_select_personal_owner ON public.task_status_history
  FOR SELECT USING (
    business_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_status_history.task_id
        AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY tsh_insert_personal_owner ON public.task_status_history
  FOR INSERT WITH CHECK (
    business_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_status_history.task_id
        AND t.owner_id = auth.uid()
    )
  );
