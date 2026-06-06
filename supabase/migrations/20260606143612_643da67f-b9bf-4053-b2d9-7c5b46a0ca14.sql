
-- Personal tasks: allow owner to delete when no business is set
CREATE POLICY tasks_delete_personal_owner ON public.tasks
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

-- Personal notes: full CRUD for owner when no business is set
CREATE POLICY notes_select_personal_owner ON public.notes
  FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY notes_insert_personal_owner ON public.notes
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY notes_update_personal_owner ON public.notes
  FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY notes_delete_personal_owner ON public.notes
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());
