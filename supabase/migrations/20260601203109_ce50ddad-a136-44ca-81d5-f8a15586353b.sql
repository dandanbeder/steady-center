
-- 1. profile status
DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('active','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.user_status NOT NULL DEFAULT 'active';

-- 2. announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- All authenticated users can SELECT active announcements (banner)
CREATE POLICY announcements_select_active ON public.announcements
  FOR SELECT TO authenticated
  USING (active = true OR public.is_platform_admin());

CREATE POLICY announcements_admin_write ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY announcements_admin_update ON public.announcements
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY announcements_admin_delete ON public.announcements
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- 3. feature_flags
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read flags (needed to gate features)
CREATE POLICY feature_flags_select_all ON public.feature_flags
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY feature_flags_admin_write ON public.feature_flags
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY feature_flags_admin_update ON public.feature_flags
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY feature_flags_admin_delete ON public.feature_flags
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- 4. admin_access_log
CREATE TABLE IF NOT EXISTS public.admin_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  reason text NOT NULL,
  mode text NOT NULL DEFAULT 'read', -- 'read' | 'write'
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_access_log_admin ON public.admin_access_log(admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_access_log_active ON public.admin_access_log(admin_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_access_log TO authenticated;
GRANT ALL ON public.admin_access_log TO service_role;
ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_access_log_admin_select ON public.admin_access_log
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY admin_access_log_admin_insert ON public.admin_access_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() AND admin_id = auth.uid());

CREATE POLICY admin_access_log_admin_update ON public.admin_access_log
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() AND admin_id = auth.uid())
  WITH CHECK (public.is_platform_admin() AND admin_id = auth.uid());

-- 5. helper to check whether the current admin has an active READ-only support session
-- If so, treat their writes as forbidden (defense-in-depth beyond UI).
CREATE OR REPLACE FUNCTION public.has_active_readonly_session()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_access_log
    WHERE admin_id = auth.uid()
      AND ended_at IS NULL
      AND mode = 'read'
  );
$$;

-- 6. updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS announcements_touch ON public.announcements;
CREATE TRIGGER announcements_touch BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS feature_flags_touch ON public.feature_flags;
CREATE TRIGGER feature_flags_touch BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
