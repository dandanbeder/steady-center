ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS sync_error text;

UPDATE public.events e
SET sync_status = 'synced'
FROM public.calendars c
WHERE e.calendar_id = c.id
  AND c.provider = 'google'
  AND e.external_id IS NOT NULL
  AND e.sync_status = 'local';