
CREATE TABLE public.assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_id uuid,
  status text NOT NULL DEFAULT 'applied',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.assistant_actions TO authenticated;
GRANT ALL ON public.assistant_actions TO service_role;

ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own assistant actions"
  ON public.assistant_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX assistant_actions_user_created_idx
  ON public.assistant_actions (user_id, created_at DESC);
