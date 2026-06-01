
-- Appearance & accessibility prefs on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS density text NOT NULL DEFAULT 'comfortable',
  ADD COLUMN IF NOT EXISTS default_calendar_view text NOT NULL DEFAULT 'week',
  ADD COLUMN IF NOT EXISTS reduced_motion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS font_size text NOT NULL DEFAULT 'normal';

-- Per-account branding + custom statuses/priorities
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS task_statuses jsonb NOT NULL DEFAULT '[
    {"key":"todo","label":"To do","color":"#94a3b8"},
    {"key":"in_progress","label":"In progress","color":"#3b82f6"},
    {"key":"done","label":"Done","color":"#10b981"}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority_labels jsonb NOT NULL DEFAULT '[
    {"key":"low","label":"Low","color":"#94a3b8"},
    {"key":"normal","label":"Normal","color":"#64748b"},
    {"key":"high","label":"High","color":"#f59e0b"},
    {"key":"urgent","label":"Urgent","color":"#ef4444"}
  ]'::jsonb;

-- Templates (per-account, for notes and tasks)
CREATE TABLE IF NOT EXISTS public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('note','task')),
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_select_member ON public.templates FOR SELECT TO authenticated
  USING (public.is_member(business_id, 'viewer') OR public.is_platform_admin());
CREATE POLICY templates_insert_member ON public.templates FOR INSERT TO authenticated
  WITH CHECK (public.is_member(business_id, 'member') OR public.is_platform_admin());
CREATE POLICY templates_update_member ON public.templates FOR UPDATE TO authenticated
  USING (public.is_member(business_id, 'member') OR public.is_platform_admin())
  WITH CHECK (public.is_member(business_id, 'member') OR public.is_platform_admin());
CREATE POLICY templates_delete_admin ON public.templates FOR DELETE TO authenticated
  USING (public.is_member(business_id, 'admin') OR public.is_platform_admin());

CREATE TRIGGER templates_touch BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Login history (audit, user-owned)
CREATE TABLE IF NOT EXISTS public.login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event text NOT NULL DEFAULT 'sign_in',
  ip text,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.login_history TO authenticated;
GRANT ALL ON public.login_history TO service_role;

ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY login_history_own_select ON public.login_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY login_history_own_insert ON public.login_history FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_login_history_user_time
  ON public.login_history (user_id, occurred_at DESC);

-- Storage bucket for account logos
INSERT INTO storage.buckets (id, name, public) VALUES ('account-logos', 'account-logos', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Account logos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'account-logos');

CREATE POLICY "Members can upload account logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'account-logos'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

CREATE POLICY "Members can update account logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'account-logos'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

CREATE POLICY "Members can delete account logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'account-logos'
    AND public.is_member(((storage.foldername(name))[1])::uuid, 'admin')
  );
