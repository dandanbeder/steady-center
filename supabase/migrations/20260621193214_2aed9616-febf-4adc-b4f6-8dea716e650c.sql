ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_start_minute smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_end_minute smallint NOT NULL DEFAULT 0;