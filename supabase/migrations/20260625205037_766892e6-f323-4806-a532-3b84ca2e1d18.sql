
-- Unified per-task audit log. Captures key changes (create, status, assignee,
-- priority, due, account/business move, completion, restore, soft-delete,
-- title, outcome). RLS mirrors tasks: only viewers of the task see its log.
CREATE TABLE public.task_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  business_id uuid,
  event_type text NOT NULL,
  from_value jsonb,
  to_value jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_audit_log_task_idx ON public.task_audit_log(task_id, created_at DESC);

GRANT SELECT, INSERT ON public.task_audit_log TO authenticated;
GRANT ALL ON public.task_audit_log TO service_role;

ALTER TABLE public.task_audit_log ENABLE ROW LEVEL SECURITY;

-- Viewers of the task can read its audit entries; platform admins can read all.
CREATE POLICY task_audit_log_select ON public.task_audit_log
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR public.can_access(auth.uid(), 'task', task_id, 'viewer')
  );

-- No direct INSERT/UPDATE/DELETE policies: entries are written exclusively by
-- the SECURITY DEFINER trigger function below. Client code cannot append to or
-- mutate the log directly.

-- Trigger: write a "created" event when a task is inserted.
CREATE OR REPLACE FUNCTION public.task_audit_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.task_audit_log(task_id, business_id, event_type, to_value, actor_id)
  VALUES (
    NEW.id,
    NEW.business_id,
    'created',
    jsonb_build_object(
      'title', NEW.title,
      'status', NEW.status,
      'priority', NEW.priority,
      'due_at', NEW.due_at,
      'assignee_id', NEW.assignee_id
    ),
    COALESCE(NEW.created_by, NEW.owner_id, auth.uid())
  );
  RETURN NEW;
END;
$$;

-- Trigger: diff important fields on update and append one row per changed field.
CREATE OR REPLACE FUNCTION public.task_audit_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'status',
            to_jsonb(OLD.status::text), to_jsonb(NEW.status::text), actor);
    -- Completion as a distinct event for the timeline.
    IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
      INSERT INTO public.task_audit_log(task_id, business_id, event_type, to_value, actor_id)
      VALUES (NEW.id, NEW.business_id, 'completed',
              to_jsonb(COALESCE(NEW.completed_at, now())), actor);
    END IF;
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'priority',
            to_jsonb(OLD.priority::text), to_jsonb(NEW.priority::text), actor);
  END IF;

  IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'due',
            to_jsonb(OLD.due_at), to_jsonb(NEW.due_at), actor);
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'assignee',
            to_jsonb(OLD.assignee_id), to_jsonb(NEW.assignee_id), actor);
  END IF;

  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'business',
            to_jsonb(OLD.business_id), to_jsonb(NEW.business_id), actor);
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'title',
            to_jsonb(OLD.title), to_jsonb(NEW.title), actor);
  END IF;

  IF NEW.outcome_id IS DISTINCT FROM OLD.outcome_id THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id, 'outcome',
            to_jsonb(OLD.outcome_id), to_jsonb(NEW.outcome_id), actor);
  END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    INSERT INTO public.task_audit_log(task_id, business_id, event_type, to_value, actor_id)
    VALUES (NEW.id, NEW.business_id,
            CASE WHEN NEW.deleted_at IS NULL THEN 'restored' ELSE 'deleted' END,
            to_jsonb(NEW.deleted_at), actor);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER task_audit_insert_trg
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.task_audit_on_insert();

CREATE TRIGGER task_audit_update_trg
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.task_audit_on_update();
