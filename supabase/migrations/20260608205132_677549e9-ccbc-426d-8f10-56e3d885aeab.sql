
-- Internal admin notes about a customer
CREATE TABLE public.admin_user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_user_notes_target ON public.admin_user_notes (target_user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_user_notes TO authenticated;
GRANT ALL ON public.admin_user_notes TO service_role;

ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superadmins read admin notes" ON public.admin_user_notes
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "Superadmins write admin notes" ON public.admin_user_notes
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "Superadmins update admin notes" ON public.admin_user_notes
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "Superadmins delete admin notes" ON public.admin_user_notes
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TRIGGER trg_admin_user_notes_touch
  BEFORE UPDATE ON public.admin_user_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Per-user feature flag overrides
CREATE TABLE public.user_feature_flag_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flag_key text NOT NULL CHECK (flag_key ~ '^[a-z0-9_.-]{1,80}$'),
  enabled boolean NOT NULL,
  expires_at timestamptz,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, flag_key)
);
CREATE INDEX idx_user_feature_flag_overrides_user ON public.user_feature_flag_overrides (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_feature_flag_overrides TO authenticated;
GRANT ALL ON public.user_feature_flag_overrides TO service_role;

ALTER TABLE public.user_feature_flag_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User reads own flag override" ON public.user_feature_flag_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY "Superadmin writes flag override" ON public.user_feature_flag_overrides
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "Superadmin updates flag override" ON public.user_feature_flag_overrides
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "Superadmin deletes flag override" ON public.user_feature_flag_overrides
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TRIGGER trg_user_feature_flag_overrides_touch
  BEFORE UPDATE ON public.user_feature_flag_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
