
-- Track one-time trial usage per account (per environment, so test runs don't burn the live trial).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_used_env text,
  ADD COLUMN IF NOT EXISTS trial_plan text;

-- SECURITY DEFINER RPC: starts a 7-day local trial. No card captured.
-- Paddle is NOT involved here; conversion later goes through the normal
-- checkout flow and the Paddle webhook replaces the row with status='active'.
CREATE OR REPLACE FUNCTION public.start_free_trial(_plan text, _env text)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles%ROWTYPE;
  existing public.subscriptions%ROWTYPE;
  new_row public.subscriptions%ROWTYPE;
  product text;
  qty int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _plan NOT IN ('pro','team') THEN
    RAISE EXCEPTION 'Invalid plan: %', _plan;
  END IF;
  IF _env NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'Invalid environment: %', _env;
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF prof.trial_used_at IS NOT NULL AND prof.trial_used_env = _env THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_USED: You have already used your free trial.';
  END IF;

  -- Block if any non-canceled sub exists for this env.
  SELECT * INTO existing
  FROM public.subscriptions
  WHERE user_id = uid AND environment = _env
    AND status IN ('active','trialing','past_due','paused')
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'TRIAL_NOT_AVAILABLE: You already have a subscription.';
  END IF;

  product := _plan || '_plan';
  qty := CASE WHEN _plan = 'team' THEN 2 ELSE 1 END;

  INSERT INTO public.subscriptions (
    user_id, paddle_subscription_id, paddle_customer_id,
    product_id, price_id, status,
    current_period_start, current_period_end,
    cancel_at_period_end, environment, quantity, billing_cycle, trial_end
  ) VALUES (
    uid,
    'trial_' || gen_random_uuid()::text,
    'trial',
    product,
    _plan || '_monthly',
    'trialing',
    now(), now() + interval '7 days',
    false, _env, qty, 'month', now() + interval '7 days'
  )
  RETURNING * INTO new_row;

  UPDATE public.profiles
    SET trial_used_at = now(),
        trial_used_env = _env,
        trial_plan = _plan
    WHERE id = uid;

  RETURN new_row;
END;
$$;

REVOKE ALL ON FUNCTION public.start_free_trial(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_free_trial(text, text) TO authenticated;
