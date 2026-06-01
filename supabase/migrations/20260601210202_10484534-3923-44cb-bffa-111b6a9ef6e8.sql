-- Time tracking + status change history

-- 1. Add status_changed_at to tasks (backfill from updated/created_at)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
UPDATE public.tasks SET status_changed_at = COALESCE(completed_at, created_at) WHERE status_changed_at IS NULL;
ALTER TABLE public.tasks ALTER COLUMN status_changed_at SET DEFAULT now();
ALTER TABLE public.tasks ALTER COLUMN status_changed_at SET NOT NULL;

-- 2. task_status_history
CREATE TABLE public.task_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  business_id uuid,
  from_status public.task_status,
  to_status public.task_status NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_status_history_task ON public.task_status_history(task_id);

GRANT SELECT, INSERT ON public.task_status_history TO authenticated;
GRANT ALL ON public.task_status_history TO service_role;

ALTER TABLE public.task_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY tsh_select_member ON public.task_status_history FOR SELECT TO authenticated
  USING (is_member(business_id, 'viewer') OR is_platform_admin());
CREATE POLICY tsh_insert_member ON public.task_status_history FOR INSERT TO authenticated
  WITH CHECK (is_member(business_id, 'member') OR is_platform_admin());

-- 3. Trigger: on status change, set status_changed_at + append history
CREATE OR REPLACE FUNCTION public.tasks_track_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    INSERT INTO public.task_status_history (task_id, business_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NEW.business_id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_track_status_change_trg
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_track_status_change();

-- 4. time_entries
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  business_id uuid,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  minutes integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','manual')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_task ON public.time_entries(task_id);
CREATE INDEX idx_time_entries_user_running ON public.time_entries(user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uniq_running_timer_per_user ON public.time_entries(user_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY te_select_member ON public.time_entries FOR SELECT TO authenticated
  USING (is_member(business_id, 'viewer') OR is_platform_admin() OR user_id = auth.uid());

CREATE POLICY te_insert_self ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (is_member(business_id, 'member') OR is_platform_admin())
  );

CREATE POLICY te_update_self ON public.time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND (is_member(business_id, 'member') OR is_platform_admin()))
  WITH CHECK (user_id = auth.uid() AND (is_member(business_id, 'member') OR is_platform_admin()));

CREATE POLICY te_delete_self ON public.time_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_member(business_id, 'admin') OR is_platform_admin());
