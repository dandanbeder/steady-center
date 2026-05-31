
-- weekly_reports table
CREATE TABLE public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  business_id UUID NULL,
  week_start TIMESTAMPTZ NOT NULL,
  week_end TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_reports TO authenticated;
GRANT ALL ON public.weekly_reports TO service_role;

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner select weekly_reports" ON public.weekly_reports
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert weekly_reports" ON public.weekly_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update weekly_reports" ON public.weekly_reports
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete weekly_reports" ON public.weekly_reports
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_weekly_reports_owner_week ON public.weekly_reports(owner_id, week_start DESC);

-- tasks.completed_at + trigger
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.tasks_set_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_set_completed_at ON public.tasks;
CREATE TRIGGER trg_tasks_set_completed_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_set_completed_at();

-- profile prefs for weekly review
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weekly_review_day SMALLINT NOT NULL DEFAULT 5, -- 0=Sun..6=Sat (5=Fri)
  ADD COLUMN IF NOT EXISTS weekly_review_hour SMALLINT NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS weekly_review_enabled BOOLEAN NOT NULL DEFAULT true;
