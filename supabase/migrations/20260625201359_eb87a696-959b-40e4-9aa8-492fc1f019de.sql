ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS weekly_hours numeric NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS general_weekly_hours numeric NULL;