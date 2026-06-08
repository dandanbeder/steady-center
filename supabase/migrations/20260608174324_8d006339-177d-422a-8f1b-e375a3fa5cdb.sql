
-- Extend announcements: targeting, 24h window, link to feature flag, kind
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS audience jsonb NOT NULL DEFAULT '{"kind":"all"}'::jsonb,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_flag_id uuid REFERENCES public.feature_flags(id) ON DELETE SET NULL;

-- Constrain kind values via trigger (no CHECK for forward-compat)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='announcements_kind_chk') THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_kind_chk
      CHECK (kind IN ('info','update','maintenance','feature'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_announcements_window
  ON public.announcements (published_at, expires_at)
  WHERE published_at IS NOT NULL AND expires_at IS NOT NULL;

-- Per-user dismissals
CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
GRANT SELECT, INSERT, DELETE ON public.announcement_dismissals TO authenticated;
GRANT ALL ON public.announcement_dismissals TO service_role;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dismissals_own_select" ON public.announcement_dismissals;
DROP POLICY IF EXISTS "dismissals_own_insert" ON public.announcement_dismissals;
DROP POLICY IF EXISTS "dismissals_own_delete" ON public.announcement_dismissals;
CREATE POLICY "dismissals_own_select" ON public.announcement_dismissals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dismissals_own_insert" ON public.announcement_dismissals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dismissals_own_delete" ON public.announcement_dismissals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Audience resolver: returns true if user matches the audience JSON
CREATE OR REPLACE FUNCTION public.user_in_audience(_user uuid, _audience jsonb)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text := COALESCE(_audience->>'kind','all');
  seg text;
  ids jsonb;
  has_sub boolean;
  is_trial boolean;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  IF k = 'all' THEN RETURN true; END IF;

  IF k = 'users' THEN
    ids := COALESCE(_audience->'user_ids','[]'::jsonb);
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(ids) t(v) WHERE t.v = _user::text
    );
  END IF;

  IF k = 'segment' THEN
    seg := COALESCE(_audience->>'segment','');
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _user
        AND s.status IN ('active','trialing')
        AND (s.current_period_end IS NULL OR s.current_period_end > now())
    ) INTO has_sub;
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _user AND s.status = 'trialing'
        AND (s.current_period_end IS NULL OR s.current_period_end > now())
    ) INTO is_trial;
    IF seg = 'free'  THEN RETURN NOT has_sub; END IF;
    IF seg = 'trial' THEN RETURN is_trial; END IF;
    IF seg IN ('pro','team','paid') THEN RETURN has_sub AND NOT is_trial; END IF;
    RETURN false;
  END IF;

  RETURN false;
END $$;

-- Update read policy to use window + audience
DROP POLICY IF EXISTS "announcements_select_active" ON public.announcements;
CREATE POLICY "announcements_select_active" ON public.announcements
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      active = true
      AND published_at IS NOT NULL AND published_at <= now()
      AND expires_at  IS NOT NULL AND expires_at  >  now()
      AND public.user_in_audience(auth.uid(), audience)
    )
  );
