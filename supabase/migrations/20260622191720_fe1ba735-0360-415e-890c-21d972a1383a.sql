
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS attendees jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS attendees jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
