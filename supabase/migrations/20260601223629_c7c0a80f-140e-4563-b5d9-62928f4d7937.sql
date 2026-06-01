-- Working hours & capacity on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_start_hour smallint NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS work_end_hour smallint NOT NULL DEFAULT 17,
  ADD COLUMN IF NOT EXISTS work_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  ADD COLUMN IF NOT EXISTS daily_capacity_hours numeric(4,2) NOT NULL DEFAULT 6.0;

-- Notification preferences
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY,
  channels jsonb NOT NULL DEFAULT jsonb_build_object('email', true, 'sms', false, 'browser', false),
  events jsonb NOT NULL DEFAULT jsonb_build_object(
    'event_reminders', true,
    'event_reminder_lead_minutes', 15,
    'task_due', true,
    'weekly_review', true,
    'meeting_summary_ready', true,
    'tagged', true
  ),
  quiet_enabled boolean NOT NULL DEFAULT false,
  quiet_start smallint NOT NULL DEFAULT 22,
  quiet_end smallint NOT NULL DEFAULT 7,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_own_select" ON public.notification_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_prefs_own_insert" ON public.notification_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_prefs_own_update" ON public.notification_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_prefs_own_delete" ON public.notification_prefs
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- AI preferences
CREATE TABLE IF NOT EXISTS public.ai_prefs (
  user_id uuid PRIMARY KEY,
  model text NOT NULL DEFAULT 'claude-sonnet-4-5',
  summary_length text NOT NULL DEFAULT 'medium',
  tone text NOT NULL DEFAULT 'neutral',
  monthly_cap_cents integer NOT NULL DEFAULT 1000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prefs_summary_length_check CHECK (summary_length IN ('short','medium','long')),
  CONSTRAINT ai_prefs_tone_check CHECK (tone IN ('neutral','friendly','formal','concise')),
  CONSTRAINT ai_prefs_cap_check CHECK (monthly_cap_cents >= 0 AND monthly_cap_cents <= 100000)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prefs TO authenticated;
GRANT ALL ON public.ai_prefs TO service_role;

ALTER TABLE public.ai_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_prefs_own_select" ON public.ai_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ai_prefs_own_insert" ON public.ai_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_prefs_own_update" ON public.ai_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- AI usage tracking
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL,
  cents integer NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_month ON public.ai_usage(user_id, month);

GRANT SELECT, INSERT, UPDATE ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_own_select" ON public.ai_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ai_usage_own_insert" ON public.ai_usage
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_usage_own_update" ON public.ai_usage
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Touch updated_at on prefs/usage
CREATE TRIGGER notification_prefs_touch_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER ai_prefs_touch_updated_at
  BEFORE UPDATE ON public.ai_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER ai_usage_touch_updated_at
  BEFORE UPDATE ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();