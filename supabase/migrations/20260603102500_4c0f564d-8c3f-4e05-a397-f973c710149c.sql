
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_anchor timestamptz;

COMMENT ON COLUMN public.tasks.recurrence_rule IS 'One of: daily, weekly, biweekly, monthly, yearly. Null = not recurring.';
