
CREATE TABLE public.account_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  allowance_credits integer NOT NULL DEFAULT 0,
  credit_balance integer NOT NULL DEFAULT 0,
  current_cycle_start timestamptz,
  current_cycle_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_credits TO authenticated;
GRANT ALL ON public.account_credits TO service_role;

ALTER TABLE public.account_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account owner reads own credits"
  ON public.account_credits FOR SELECT
  TO authenticated
  USING (account_user_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "Super admin updates any credits"
  ON public.account_credits FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Super admin inserts credits"
  ON public.account_credits FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_account_credits_touch
  BEFORE UPDATE ON public.account_credits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
