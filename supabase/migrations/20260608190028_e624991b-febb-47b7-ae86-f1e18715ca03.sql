-- #3/#5 (Option C): tighten read leaks on collaboration-shared tables.
-- Business membership alone no longer grants visibility into rows tied to
-- specific items the caller can't view.

-- 1) note_links: require viewer access on the source note.
DROP POLICY IF EXISTS note_links_select ON public.note_links;
CREATE POLICY note_links_select
ON public.note_links
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR public.is_tagged('note', from_note_id)
  OR public.can_access(auth.uid(), 'note', from_note_id, 'viewer')
);

-- 2) item_tags: tagged user always sees; business members only when they
-- can view the underlying item.
DROP POLICY IF EXISTS item_tags_select ON public.item_tags;
CREATE POLICY item_tags_select
ON public.item_tags
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR tagged_user_id = auth.uid()
  OR (item_type IN ('task','note','event','folder','list','calendar')
      AND public.can_access(auth.uid(), item_type, item_id, 'viewer'))
);

-- 3) task_status_history: require viewer access on the underlying task.
DROP POLICY IF EXISTS tsh_select_member ON public.task_status_history;
DROP POLICY IF EXISTS task_status_history_select_member ON public.task_status_history;
DROP POLICY IF EXISTS task_status_history_select ON public.task_status_history;
CREATE POLICY task_status_history_select
ON public.task_status_history
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR public.can_access(auth.uid(), 'task', task_id, 'viewer')
);

-- 4) task_assignment_history: same tightening.
DROP POLICY IF EXISTS tah_select_member ON public.task_assignment_history;
DROP POLICY IF EXISTS task_assignment_history_select_member ON public.task_assignment_history;
DROP POLICY IF EXISTS task_assignment_history_select ON public.task_assignment_history;
CREATE POLICY task_assignment_history_select
ON public.task_assignment_history
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR public.can_access(auth.uid(), 'task', task_id, 'viewer')
);
