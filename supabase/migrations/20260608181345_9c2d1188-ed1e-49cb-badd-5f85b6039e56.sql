
-- Add task assignment support
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks(assignee_id) WHERE assignee_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON public.tasks(assignee_id, status, due_at) WHERE deleted_at IS NULL;

-- BEFORE trigger to validate assignee membership & auto-stamp assigned_by/at
CREATE OR REPLACE FUNCTION public.tasks_validate_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_rank int;
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM (CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.assignee_id END) THEN
    -- stamp assigner
    IF NEW.assignee_id IS NULL THEN
      NEW.assigned_by := auth.uid();
      NEW.assigned_at := now();
    ELSE
      -- validate
      IF NEW.business_id IS NULL THEN
        IF NEW.assignee_id <> NEW.owner_id THEN
          RAISE EXCEPTION 'Personal tasks can only be assigned to their owner';
        END IF;
      ELSE
        SELECT m.role::text INTO v_role
          FROM public.memberships m
         WHERE m.business_id = NEW.business_id
           AND m.user_id = NEW.assignee_id
           AND m.status = 'active'
         LIMIT 1;
        IF v_role IS NULL THEN
          RAISE EXCEPTION 'Assignee is not a member of this account';
        END IF;
        v_rank := CASE v_role
          WHEN 'viewer' THEN 1
          WHEN 'commenter' THEN 2
          WHEN 'member' THEN 3
          WHEN 'admin' THEN 4
          WHEN 'owner' THEN 5
          ELSE 0
        END;
        IF v_rank < 3 THEN
          RAISE EXCEPTION 'Viewers and commenters cannot be assigned tasks';
        END IF;
      END IF;
      NEW.assigned_by := COALESCE(auth.uid(), NEW.assigned_by);
      NEW.assigned_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_validate_assignment ON public.tasks;
CREATE TRIGGER trg_tasks_validate_assignment
  BEFORE INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_validate_assignment();

-- Assignment history (activity log)
CREATE TABLE IF NOT EXISTS public.task_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  business_id uuid,
  from_assignee uuid,
  to_assignee uuid,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.task_assignment_history TO authenticated;
GRANT ALL ON public.task_assignment_history TO service_role;
ALTER TABLE public.task_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tah_select_member ON public.task_assignment_history;
CREATE POLICY tah_select_member ON public.task_assignment_history
  FOR SELECT TO authenticated
  USING (
    (business_id IS NOT NULL AND (public.is_member(business_id,'viewer') OR public.is_platform_admin()))
    OR (business_id IS NULL AND EXISTS (
      SELECT 1 FROM public.tasks t WHERE t.id = task_assignment_history.task_id AND t.owner_id = auth.uid()
    ))
  );

CREATE INDEX IF NOT EXISTS idx_tah_task ON public.task_assignment_history(task_id, changed_at DESC);

-- AFTER trigger: log assignment changes + notify assignee
CREATE OR REPLACE FUNCTION public.tasks_track_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old uuid;
  v_assigner_name text;
  v_link text;
BEGIN
  v_old := CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.assignee_id END;
  IF NEW.assignee_id IS DISTINCT FROM v_old THEN
    INSERT INTO public.task_assignment_history(task_id, business_id, from_assignee, to_assignee, changed_by)
    VALUES (NEW.id, NEW.business_id, v_old, NEW.assignee_id, auth.uid());

    IF NEW.assignee_id IS NOT NULL AND NEW.assignee_id <> COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid) THEN
      SELECT COALESCE(full_name,'') INTO v_assigner_name FROM public.profiles WHERE id = auth.uid();
      v_link := '/tasks?focus=' || NEW.id::text;
      INSERT INTO public.notifications(user_id, kind, title, body, ref_type, ref_id, link, business_id)
      VALUES (
        NEW.assignee_id,
        'task_assigned',
        COALESCE(NULLIF(v_assigner_name,''),'Someone') || ' assigned you a task',
        left(NEW.title, 240),
        'task', NEW.id, v_link, NEW.business_id
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_track_assignment ON public.tasks;
CREATE TRIGGER trg_tasks_track_assignment
  AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_track_assignment();

-- Notify assigner on completion (if completer != assigner and there is an assigner)
CREATE OR REPLACE FUNCTION public.tasks_notify_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completer text;
  v_link text;
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done'
     AND NEW.assigned_by IS NOT NULL
     AND NEW.assigned_by <> COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid) THEN
    SELECT COALESCE(full_name,'') INTO v_completer FROM public.profiles WHERE id = auth.uid();
    v_link := '/tasks?focus=' || NEW.id::text;
    INSERT INTO public.notifications(user_id, kind, title, body, ref_type, ref_id, link, business_id)
    VALUES (
      NEW.assigned_by,
      'task_completed',
      COALESCE(NULLIF(v_completer,''),'Someone') || ' completed a task you assigned',
      left(NEW.title, 240),
      'task', NEW.id, v_link, NEW.business_id
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_notify_completion ON public.tasks;
CREATE TRIGGER trg_tasks_notify_completion
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_notify_completion();

REVOKE EXECUTE ON FUNCTION public.tasks_validate_assignment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tasks_track_assignment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tasks_notify_completion() FROM PUBLIC;
