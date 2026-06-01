-- Dedupe imported / synced events by their source identity + start time.
-- A recurring event has one UID but many DTSTART instances; this index
-- treats each instance as unique while still blocking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_external_idx
  ON public.events (calendar_id, external_id, start_at)
  WHERE external_id IS NOT NULL;