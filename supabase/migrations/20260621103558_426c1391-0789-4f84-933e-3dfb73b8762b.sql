
CREATE TABLE public.task_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  view text NOT NULL DEFAULT 'list',
  group_by text NOT NULL DEFAULT 'stage',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sort" jsonb NOT NULL DEFAULT '{"key":"priority"}'::jsonb,
  column_order text[] NOT NULL DEFAULT '{}',
  collapsed_groups text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT true,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_views_list_owner_idx ON public.task_views(list_id, owner_id);
CREATE INDEX task_views_list_shared_idx ON public.task_views(list_id) WHERE is_shared;
CREATE UNIQUE INDEX task_views_one_default_per_user_list
  ON public.task_views(list_id, owner_id) WHERE is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_views TO authenticated;
GRANT ALL ON public.task_views TO service_role;

ALTER TABLE public.task_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_views_select ON public.task_views FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (is_shared AND public.can_access(auth.uid(), 'list', list_id, 'viewer'))
  );

CREATE POLICY task_views_insert ON public.task_views FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.can_access(auth.uid(), 'list', list_id, 'viewer')
  );

CREATE POLICY task_views_update ON public.task_views FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY task_views_delete ON public.task_views FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE TRIGGER task_views_set_updated_at
  BEFORE UPDATE ON public.task_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
