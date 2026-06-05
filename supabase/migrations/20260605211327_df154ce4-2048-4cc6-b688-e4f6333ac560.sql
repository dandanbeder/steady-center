
CREATE TABLE public.daily_pulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pulse_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('morning', 'evening')),
  summary_text text,
  meetings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  focus_3 jsonb NOT NULL DEFAULT '[]'::jsonb,
  overdue_count int NOT NULL DEFAULT 0,
  at_risk_count int NOT NULL DEFAULT 0,
  capacity_hours numeric NOT NULL DEFAULT 0,
  scheduled_hours numeric NOT NULL DEFAULT 0,
  generated_at timestamptz,
  email_sent_at timestamptz,
  confirmed_focus_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, pulse_date, kind)
);

CREATE INDEX idx_daily_pulses_owner_date ON public.daily_pulses (owner_id, pulse_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_pulses TO authenticated;
GRANT ALL ON public.daily_pulses TO service_role;

ALTER TABLE public.daily_pulses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pulses_select_own" ON public.daily_pulses FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pulses_insert_own" ON public.daily_pulses FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pulses_update_own" ON public.daily_pulses FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pulses_delete_own" ON public.daily_pulses FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER trg_daily_pulses_touch
  BEFORE UPDATE ON public.daily_pulses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
