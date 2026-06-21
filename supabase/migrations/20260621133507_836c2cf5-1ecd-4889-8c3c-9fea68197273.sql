CREATE TABLE IF NOT EXISTS public.ai_cap_hits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type     text NOT NULL,
  sub_action      text,
  cap_kind        text NOT NULL CHECK (cap_kind IN ('input_chars','transcript_chars','context_items','output_tokens')),
  cap_value       integer NOT NULL,
  observed_value  integer NOT NULL,
  model_used      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cap_hits_action_created_idx
  ON public.ai_cap_hits (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_cap_hits_user_created_idx
  ON public.ai_cap_hits (user_id, created_at DESC);

GRANT SELECT ON public.ai_cap_hits TO authenticated;
GRANT ALL    ON public.ai_cap_hits TO service_role;

ALTER TABLE public.ai_cap_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_cap_hits: super-admins read" ON public.ai_cap_hits;
CREATE POLICY "ai_cap_hits: super-admins read"
  ON public.ai_cap_hits
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());