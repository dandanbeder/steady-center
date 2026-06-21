
-- 1. task_stages: per-list workflow stages
CREATE TABLE public.task_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#7A8471',
  position int NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'custom', -- 'todo' | 'in_progress' | 'review' | 'done' | 'custom'
  is_terminal boolean NOT NULL DEFAULT false, -- true == completed-like
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_stages_list ON public.task_stages(list_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_stages TO authenticated;
GRANT ALL ON public.task_stages TO service_role;

ALTER TABLE public.task_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_stages_select ON public.task_stages FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'list', list_id, 'viewer'));
CREATE POLICY task_stages_insert ON public.task_stages FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'list', list_id, 'member'));
CREATE POLICY task_stages_update ON public.task_stages FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'list', list_id, 'member'))
  WITH CHECK (public.can_access(auth.uid(), 'list', list_id, 'member'));
CREATE POLICY task_stages_delete ON public.task_stages FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'list', list_id, 'admin'));

CREATE TRIGGER task_stages_touch
  BEFORE UPDATE ON public.task_stages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Seed defaults helper + trigger on new lists
CREATE OR REPLACE FUNCTION public.seed_default_task_stages(p_list_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.task_stages WHERE list_id = p_list_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.task_stages (list_id, name, color, position, kind, is_terminal) VALUES
    (p_list_id, 'To do',       '#9aa39a', 0, 'todo',        false),
    (p_list_id, 'In progress', '#c79a6b', 1, 'in_progress', false),
    (p_list_id, 'Review',      '#7a8aa0', 2, 'review',      false),
    (p_list_id, 'Done',        '#7a9b7a', 3, 'done',        true);
END $$;

CREATE OR REPLACE FUNCTION public.lists_seed_default_stages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.seed_default_task_stages(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER lists_seed_stages
  AFTER INSERT ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.lists_seed_default_stages();

-- 3. tasks: stage_id + per-stage position
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.task_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_position int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_stage ON public.tasks(stage_id, stage_position);

-- 4. Seed stages for every existing list & migrate existing task.status -> stage_id
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.lists LOOP
    PERFORM public.seed_default_task_stages(r.id);
  END LOOP;
END $$;

UPDATE public.tasks t
SET stage_id = s.id
FROM public.task_stages s
WHERE s.list_id = t.list_id
  AND t.stage_id IS NULL
  AND s.kind = CASE t.status::text
                 WHEN 'todo' THEN 'todo'
                 WHEN 'in_progress' THEN 'in_progress'
                 WHEN 'review' THEN 'review'
                 WHEN 'done' THEN 'done'
                 ELSE 'todo'
               END;

-- Backfill per-stage ordering by current position
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY stage_id ORDER BY position, created_at) - 1 AS rn
  FROM public.tasks
  WHERE stage_id IS NOT NULL
)
UPDATE public.tasks t SET stage_position = o.rn
FROM ordered o WHERE o.id = t.id;

-- 5. Keep tasks.status in sync with stage_id (mirror for back-compat)
CREATE OR REPLACE FUNCTION public.tasks_sync_status_from_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text;
  v_terminal boolean;
BEGIN
  IF NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  SELECT kind, is_terminal INTO v_kind, v_terminal
    FROM public.task_stages WHERE id = NEW.stage_id;
  IF v_terminal THEN
    NEW.status := 'done';
  ELSIF v_kind IN ('todo','in_progress','review') THEN
    NEW.status := v_kind::task_status;
  ELSE
    -- Custom non-terminal stage: keep as in_progress so existing filters work
    NEW.status := 'in_progress';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_sync_status_from_stage
  BEFORE INSERT OR UPDATE OF stage_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_status_from_stage();

-- 6. user_list_views: per-user saved view config
CREATE TABLE public.user_list_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  view text NOT NULL DEFAULT 'board', -- 'board' | 'list'
  group_by text NOT NULL DEFAULT 'stage', -- 'stage' | 'priority' | 'assignee' | 'due' | 'tag'
  sort jsonb NOT NULL DEFAULT '{"field":"stage_position","dir":"asc"}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  collapsed_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, list_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_list_views TO authenticated;
GRANT ALL ON public.user_list_views TO service_role;

ALTER TABLE public.user_list_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_list_views_select_own ON public.user_list_views FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY user_list_views_insert_own ON public.user_list_views FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access(auth.uid(), 'list', list_id, 'viewer'));
CREATE POLICY user_list_views_update_own ON public.user_list_views FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY user_list_views_delete_own ON public.user_list_views FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER user_list_views_touch
  BEFORE UPDATE ON public.user_list_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
