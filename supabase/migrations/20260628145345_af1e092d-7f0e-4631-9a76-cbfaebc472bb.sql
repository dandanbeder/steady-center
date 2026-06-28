ALTER TABLE public.calendars
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error_at TIMESTAMPTZ;