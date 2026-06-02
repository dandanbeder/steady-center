CREATE TABLE public.password_reset_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_attempts_email_time_idx
  ON public.password_reset_attempts (email_hash, attempted_at DESC);

GRANT ALL ON public.password_reset_attempts TO service_role;
ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (server) writes/reads.