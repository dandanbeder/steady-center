ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_estimated_minutes_nonneg CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0) NOT VALID;
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_estimated_minutes_nonneg;