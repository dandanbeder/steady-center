
-- Extend outcomes with success statement, measurable metric, and richer statuses.
ALTER TYPE public.outcome_status ADD VALUE IF NOT EXISTS 'not_started';
ALTER TYPE public.outcome_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE public.outcome_status ADD VALUE IF NOT EXISTS 'at_risk';

ALTER TABLE public.outcomes
  ADD COLUMN IF NOT EXISTS success_statement text,
  ADD COLUMN IF NOT EXISTS metric_name text,
  ADD COLUMN IF NOT EXISTS metric_target numeric,
  ADD COLUMN IF NOT EXISTS metric_current numeric,
  ADD COLUMN IF NOT EXISTS metric_unit text;

-- Helpful index for grouping/filtering tasks by outcome
CREATE INDEX IF NOT EXISTS tasks_outcome_id_idx ON public.tasks (outcome_id) WHERE outcome_id IS NOT NULL;
