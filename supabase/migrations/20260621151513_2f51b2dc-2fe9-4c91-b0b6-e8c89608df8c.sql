ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_emails_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_optional_disabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deletion_requested_at   timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_completes_at   timestamptz;

DROP POLICY IF EXISTS "admin_access_log_target_select" ON public.admin_access_log;
CREATE POLICY "admin_access_log_target_select"
  ON public.admin_access_log FOR SELECT
  TO authenticated
  USING (target_user_id = auth.uid());