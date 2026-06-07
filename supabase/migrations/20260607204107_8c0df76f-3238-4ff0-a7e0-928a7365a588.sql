
-- Append-only admin audit log
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  target_user_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_log_target ON public.admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_admin ON public.admin_audit_log(admin_id, created_at DESC);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT INSERT, SELECT ON public.admin_audit_log TO service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can view audit log"
  ON public.admin_audit_log FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Block updates and deletes from anyone (including service_role) to guarantee append-only
CREATE OR REPLACE FUNCTION public.admin_audit_log_block_modify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_block_modify();

CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_block_modify();

-- Per-user entitlement overrides
CREATE TABLE public.user_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX idx_entitlement_overrides_user ON public.user_entitlement_overrides(user_id);

GRANT SELECT ON public.user_entitlement_overrides TO authenticated;
GRANT ALL ON public.user_entitlement_overrides TO service_role;

ALTER TABLE public.user_entitlement_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own overrides"
  ON public.user_entitlement_overrides FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

-- Profile additions for suspension messaging + soft delete
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_message text,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid;
