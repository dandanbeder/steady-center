
CREATE TABLE public.email_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

GRANT SELECT ON public.email_unsubscribe_tokens TO authenticated;
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own unsubscribe token"
  ON public.email_unsubscribe_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_email_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

CREATE OR REPLACE FUNCTION public.get_or_create_unsubscribe_token(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  SELECT token INTO v_token FROM public.email_unsubscribe_tokens WHERE user_id = p_user_id;
  IF v_token IS NULL THEN
    v_token := encode(gen_random_bytes(24), 'hex');
    INSERT INTO public.email_unsubscribe_tokens (user_id, token)
    VALUES (p_user_id, v_token)
    ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token
    RETURNING token INTO v_token;
  END IF;
  RETURN v_token;
END;
$$;
