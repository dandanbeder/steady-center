
CREATE TABLE public.calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#7A8471',
  provider text NOT NULL DEFAULT 'manual',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendars TO authenticated;
GRANT ALL ON public.calendars TO service_role;

ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner select calendars" ON public.calendars FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert calendars" ON public.calendars FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update calendars" ON public.calendars FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete calendars" ON public.calendars FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_calendars_owner ON public.calendars(owner_id);
CREATE INDEX idx_calendars_business ON public.calendars(business_id);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  location text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner select events" ON public.events FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert events" ON public.events FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update events" ON public.events FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete events" ON public.events FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_events_owner ON public.events(owner_id);
CREATE INDEX idx_events_calendar ON public.events(calendar_id);
CREATE INDEX idx_events_business ON public.events(business_id);
CREATE INDEX idx_events_start ON public.events(start_at);
