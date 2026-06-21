-- Switch free trial from 7 days to 14 days, and auto-start a Pro trial
-- on signup (live environment). Sandbox trial remains opt-in via /billing.

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
    now(), now() + interval '14 days',
    false, _env, qty, 'month', now() + interval '14 days'
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

-- Auto-grant a 14-day Pro trial (live env) on every new signup.
-- Runs AFTER INSERT on public.profiles so the trigger sees a profile row.
CREATE OR REPLACE FUNCTION public.grant_signup_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip if this profile already had a trial (e.g. backfill or replay).
  IF NEW.trial_used_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.subscriptions (
    user_id, paddle_subscription_id, paddle_customer_id,
    product_id, price_id, status,
    current_period_start, current_period_end,
    cancel_at_period_end, environment, quantity, billing_cycle, trial_end
  ) VALUES (
    NEW.id,
    'trial_' || gen_random_uuid()::text,
    'trial',
    'pro_plan',
    'pro_monthly',
    'trialing',
    now(), now() + interval '14 days',
    false, 'live', 1, 'month', now() + interval '14 days'
  )
  ON CONFLICT (paddle_subscription_id) DO NOTHING;

  UPDATE public.profiles
    SET trial_used_at = now(),
        trial_used_env = 'live',
        trial_plan = 'pro'
    WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block signup if trial provisioning fails.
  RAISE WARNING 'grant_signup_trial failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_grant_signup_trial ON public.profiles;
CREATE TRIGGER trg_profiles_grant_signup_trial
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_signup_trial();

REVOKE ALL ON FUNCTION public.grant_signup_trial() FROM public, anon, authenticated;