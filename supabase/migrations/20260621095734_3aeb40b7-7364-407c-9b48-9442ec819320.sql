
ALTER TABLE public.tasks ALTER COLUMN list_id DROP NOT NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_uncategorised_consistency,
  ADD CONSTRAINT tasks_uncategorised_consistency
    CHECK (list_id IS NOT NULL OR business_id IS NULL);

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      (list_id IS NOT NULL AND public.can_access(auth.uid(), 'list', list_id, 'member'))
      OR (list_id IS NULL AND business_id IS NULL)
    )
  );

CREATE INDEX IF NOT EXISTS tasks_uncategorised_owner_idx
  ON public.tasks(owner_id)
  WHERE list_id IS NULL AND deleted_at IS NULL;
