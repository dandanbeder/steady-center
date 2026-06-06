ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS committed_week date;

COMMENT ON COLUMN public.tasks.committed_week IS
  'Monday (UTC) of the ISO week the task is committed to. NULL = uncommitted (backlog).';

CREATE INDEX IF NOT EXISTS idx_tasks_committed_week
  ON public.tasks (owner_id, committed_week)
  WHERE committed_week IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_backlog
  ON public.tasks (owner_id, priority, due_at)
  WHERE committed_week IS NULL
    AND deleted_at IS NULL
    AND status <> 'done';