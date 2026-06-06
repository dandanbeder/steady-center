
CREATE TYPE public.outcome_status AS ENUM ('active','achieved','archived');

CREATE TABLE public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  target_date date,
  status public.outcome_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcomes_business ON public.outcomes(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX idx_outcomes_owner ON public.outcomes(owner_id) WHERE business_id IS NULL;
CREATE INDEX idx_outcomes_status ON public.outcomes(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outcomes TO authenticated;
GRANT ALL ON public.outcomes TO service_role;

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcomes_select_member" ON public.outcomes FOR SELECT
  USING (business_id IS NOT NULL AND (public.is_member(business_id, 'viewer') OR public.is_platform_admin()));
CREATE POLICY "outcomes_select_personal_owner" ON public.outcomes FOR SELECT
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY "outcomes_insert_member" ON public.outcomes FOR INSERT
  WITH CHECK (
    owner_id = auth.uid() AND (
      (business_id IS NOT NULL AND public.is_member(business_id, 'member'))
      OR (business_id IS NULL)
    )
  );

CREATE POLICY "outcomes_update_member" ON public.outcomes FOR UPDATE
  USING (business_id IS NOT NULL AND (public.is_member(business_id, 'member') OR public.is_platform_admin()));
CREATE POLICY "outcomes_update_personal_owner" ON public.outcomes FOR UPDATE
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE POLICY "outcomes_delete_admin" ON public.outcomes FOR DELETE
  USING (business_id IS NOT NULL AND (public.is_member(business_id, 'admin') OR public.is_platform_admin()));
CREATE POLICY "outcomes_delete_personal_owner" ON public.outcomes FOR DELETE
  USING (business_id IS NULL AND owner_id = auth.uid());

CREATE TRIGGER outcomes_touch_updated_at
  BEFORE UPDATE ON public.outcomes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Link tasks to outcomes
ALTER TABLE public.tasks
  ADD COLUMN outcome_id uuid REFERENCES public.outcomes(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_outcome ON public.tasks(outcome_id)
  WHERE outcome_id IS NOT NULL AND deleted_at IS NULL;
