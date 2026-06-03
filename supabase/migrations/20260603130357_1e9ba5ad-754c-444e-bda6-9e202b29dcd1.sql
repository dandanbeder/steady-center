-- 1) Events: meeting flag
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_meeting boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_is_meeting_start
  ON public.events (is_meeting, start_at)
  WHERE is_meeting = true;

-- 2) Reminders: track which lead time and kind so we never double-send
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS lead_minutes integer,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';

-- One reminder per (event/task, channel, lead_minutes) when lead_minutes is set
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reminders_ref_channel_lead
  ON public.reminders (ref_type, ref_id, channel, lead_minutes)
  WHERE lead_minutes IS NOT NULL;

-- 3) Trigger: keep meeting reminders in sync with events.is_meeting
CREATE OR REPLACE FUNCTION public.ensure_meeting_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefs_channels jsonb;
  prefs_events jsonb;
  leads int[];
  extra_json jsonb;
  lead int;
  ch text;
BEGIN
  -- If not a meeting (or just turned off), drop any pending meeting reminders
  IF NEW.is_meeting IS NOT TRUE THEN
    DELETE FROM public.reminders
     WHERE ref_type = 'event'
       AND ref_id = NEW.id
       AND kind = 'meeting'
       AND sent = false;
    RETURN NEW;
  END IF;

  -- Don't schedule for events already in the past
  IF NEW.start_at <= now() THEN
    RETURN NEW;
  END IF;

  SELECT channels, events
    INTO prefs_channels, prefs_events
  FROM public.notification_prefs
  WHERE user_id = NEW.owner_id;

  IF prefs_channels IS NULL THEN
    prefs_channels := jsonb_build_object('email', true, 'sms', false, 'browser', false);
  END IF;

  -- Always include the standard pair, plus any user-defined extras
  leads := ARRAY[15, 5];
  extra_json := COALESCE(prefs_events->'meeting_lead_minutes_extra', '[]'::jsonb);
  IF jsonb_typeof(extra_json) = 'array' THEN
    SELECT leads || COALESCE(array_agg(DISTINCT (v)::int), ARRAY[]::int[])
      INTO leads
    FROM jsonb_array_elements_text(extra_json) AS t(v)
    WHERE v ~ '^[0-9]+$';
  END IF;

  FOREACH lead IN ARRAY leads LOOP
    FOREACH ch IN ARRAY ARRAY['email','sms'] LOOP
      IF COALESCE((prefs_channels->>ch)::boolean, false) THEN
        INSERT INTO public.reminders
          (owner_id, ref_type, ref_id, remind_at, channel, kind, lead_minutes)
        VALUES
          (NEW.owner_id, 'event', NEW.id,
           NEW.start_at - make_interval(mins => lead),
           ch, 'meeting', lead)
        ON CONFLICT (ref_type, ref_id, channel, lead_minutes) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_ensure_meeting_reminders_ins ON public.events;
CREATE TRIGGER events_ensure_meeting_reminders_ins
AFTER INSERT ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.ensure_meeting_reminders();

DROP TRIGGER IF EXISTS events_ensure_meeting_reminders_upd ON public.events;
CREATE TRIGGER events_ensure_meeting_reminders_upd
AFTER UPDATE OF is_meeting, start_at, owner_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.ensure_meeting_reminders();