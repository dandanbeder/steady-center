ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS high_contrast boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_color_by text NOT NULL DEFAULT 'account';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_event_color_by_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_event_color_by_check
  CHECK (event_color_by IN ('account', 'calendar'));