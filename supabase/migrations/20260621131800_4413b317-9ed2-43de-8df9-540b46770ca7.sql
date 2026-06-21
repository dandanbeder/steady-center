
CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid,
  action_type text NOT NULL,
  model_used text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  audio_seconds integer NOT NULL DEFAULT 0,
  true_cost_micros bigint NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_events_user_created_idx
  ON public.ai_usage_events (user_id, created_at DESC);
CREATE INDEX ai_usage_events_action_created_idx
  ON public.ai_usage_events (action_type, created_at DESC);
CREATE INDEX ai_usage_events_team_created_idx
  ON public.ai_usage_events (team_id, created_at DESC) WHERE team_id IS NOT NULL;

GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can read ai usage events"
  ON public.ai_usage_events
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
