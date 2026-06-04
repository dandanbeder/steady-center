
-- Personal (non-account) calendars: allow owner full access when business_id is null.
CREATE POLICY "calendars_select_personal_owner" ON public.calendars
  FOR SELECT TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "calendars_insert_personal_owner" ON public.calendars
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "calendars_update_personal_owner" ON public.calendars
  FOR UPDATE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid())
  WITH CHECK (business_id IS NULL AND owner_id = auth.uid());
CREATE POLICY "calendars_delete_personal_owner" ON public.calendars
  FOR DELETE TO authenticated
  USING (business_id IS NULL AND owner_id = auth.uid());

-- Recurrence columns on events (rule + optional end date)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_end date;

-- Auto-create a default "General" calendar for every new business.
CREATE OR REPLACE FUNCTION public.businesses_seed_default_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.calendars (owner_id, business_id, name, color, provider)
  SELECT NEW.owner_id, NEW.id, 'General', COALESCE(NEW.color, '#7A8471'), 'manual'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.calendars c WHERE c.business_id = NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_seed_calendar ON public.businesses;
CREATE TRIGGER trg_businesses_seed_calendar
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_seed_default_calendar();

-- Backfill: ensure every existing business has at least one calendar.
INSERT INTO public.calendars (owner_id, business_id, name, color, provider)
SELECT b.owner_id, b.id, 'General', COALESCE(b.color, '#7A8471'), 'manual'
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.calendars c WHERE c.business_id = b.id
);
