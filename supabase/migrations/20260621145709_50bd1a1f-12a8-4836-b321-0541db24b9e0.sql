ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hour_format text NOT NULL DEFAULT '24h',
  ADD COLUMN IF NOT EXISTS week_start_day smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_landing text NOT NULL DEFAULT 'today';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_hour_format_check,
  ADD CONSTRAINT profiles_hour_format_check CHECK (hour_format IN ('12h','24h'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_week_start_day_check,
  ADD CONSTRAINT profiles_week_start_day_check CHECK (week_start_day IN (0,1));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_default_landing_check,
  ADD CONSTRAINT profiles_default_landing_check CHECK (default_landing IN ('today','calendar'));