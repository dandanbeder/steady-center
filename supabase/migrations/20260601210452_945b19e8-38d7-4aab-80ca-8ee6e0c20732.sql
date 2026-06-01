DO $$ BEGIN
  CREATE TYPE public.goal_metric_type AS ENUM ('tasks_completed','hours','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.goal_status AS ENUM ('open','met','missed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.weekly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  business_id uuid,
  week_start timestamptz NOT NULL,
  week_end timestamptz NOT NULL,
  title text NOT NULL,
  description text,
  metric_type public.goal_metric_type NOT NULL DEFAULT 'custom',
  target_value numeric,
  current_value numeric NOT NULL DEFAULT 0,
  status public.goal_status NOT NULL DEFAULT 'open',
  carried_from uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_weekly_goals_user_week ON public.weekly_goals(user_id, week_start);
CREATE INDEX idx_weekly_goals_business ON public.weekly_goals(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_goals TO authenticated;
GRANT ALL ON public.weekly_goals TO service_role;

ALTER TABLE public.weekly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY wg_select_own ON public.weekly_goals FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_platform_admin());

CREATE POLICY wg_insert_own ON public.weekly_goals FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (business_id IS NULL OR is_member(business_id, 'viewer'))
  );

CREATE POLICY wg_update_own ON public.weekly_goals FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (business_id IS NULL OR is_member(business_id, 'viewer'))
  );

CREATE POLICY wg_delete_own ON public.weekly_goals FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER weekly_goals_touch_updated_at
BEFORE UPDATE ON public.weekly_goals
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
