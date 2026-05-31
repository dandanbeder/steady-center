
-- Add phone for SMS reminders (column on existing profiles)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- Add sync_token to calendars for Google incremental sync
ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS sync_token text;
ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Reminders table
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  ref_type text NOT NULL CHECK (ref_type IN ('event','task')),
  ref_id uuid NOT NULL,
  remind_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reminders_due_idx ON public.reminders (sent, remind_at);
CREATE INDEX reminders_ref_idx ON public.reminders (ref_type, ref_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner select reminders" ON public.reminders FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert reminders" ON public.reminders FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update reminders" ON public.reminders FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete reminders" ON public.reminders FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Keep reminder times in sync when an event start moves.
-- Stores lead_minutes implicitly via the delta between reminders.remind_at and events.start_at at creation time.
CREATE OR REPLACE FUNCTION public.shift_event_reminders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta interval;
BEGIN
  IF NEW.start_at IS DISTINCT FROM OLD.start_at THEN
    delta := NEW.start_at - OLD.start_at;
    UPDATE public.reminders
       SET remind_at = remind_at + delta
     WHERE ref_type = 'event' AND ref_id = NEW.id AND sent = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_shift_reminders
AFTER UPDATE OF start_at ON public.events
FOR EACH ROW EXECUTE FUNCTION public.shift_event_reminders();

CREATE OR REPLACE FUNCTION public.shift_task_reminders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta interval;
BEGIN
  IF NEW.due_at IS DISTINCT FROM OLD.due_at AND NEW.due_at IS NOT NULL AND OLD.due_at IS NOT NULL THEN
    delta := NEW.due_at - OLD.due_at;
    UPDATE public.reminders
       SET remind_at = remind_at + delta
     WHERE ref_type = 'task' AND ref_id = NEW.id AND sent = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_shift_reminders
AFTER UPDATE OF due_at ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.shift_task_reminders();
