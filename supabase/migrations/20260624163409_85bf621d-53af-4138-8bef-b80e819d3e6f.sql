-- 1) Remove the new-signup auto-trial: users land on Free, no auto-trial.
DROP TRIGGER IF EXISTS trg_profiles_grant_signup_trial ON public.profiles;
DROP FUNCTION IF EXISTS public.grant_signup_trial();

-- 2) Restrict start_free_trial to Team only, 7 days, no card required.
CREATE OR REPLACE FUNCTION public.start_free_trial(_plan text, _env text)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles%ROWTYPE;
  existing public.subscriptions%ROWTYPE;
  new_row public.subscriptions%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _plan <> 'team' THEN
    RAISE EXCEPTION 'TRIAL_NOT_AVAILABLE: Free trials are only available on the Team plan.';
  END IF;
  IF _env NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Invalid environment: %', _env; END IF;

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

  INSERT INTO public.subscriptions (
    user_id, paddle_subscription_id, paddle_customer_id,
    product_id, price_id, status,
    current_period_start, current_period_end,
    cancel_at_period_end, environment, quantity, billing_cycle, trial_end
  ) VALUES (
    uid, 'trial_' || gen_random_uuid()::text, 'trial',
    'team_plan', 'team_monthly', 'trialing',
    now(), now() + interval '7 days',
    false, _env, 2, 'month', now() + interval '7 days'
  ) RETURNING * INTO new_row;

  UPDATE public.profiles
    SET trial_used_at = now(), trial_used_env = _env, trial_plan = 'team'
    WHERE id = uid;

  RETURN new_row;
END;
$function$;

-- 3) An active trial maps to the Team tier (trial = Team only).
CREATE OR REPLACE FUNCTION public.user_effective_plan(p_user uuid)
RETURNS TABLE(tier text, quantity integer, billing_cycle text, status text, trial_end timestamp with time zone, current_period_end timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sub AS (
    SELECT *
      FROM public.subscriptions
     WHERE user_id = p_user
       AND environment = COALESCE(current_setting('app.paddle_env', true), 'live')
     ORDER BY created_at DESC
     LIMIT 1
  )
  SELECT
    CASE
      WHEN s.product_id = 'team_plan'  AND public.is_sub_active(s.status, s.current_period_end) THEN 'team'
      WHEN s.product_id = 'pro_plan'   AND public.is_sub_active(s.status, s.current_period_end) THEN 'pro'
      WHEN s.product_id = 'basic_plan' AND public.is_sub_active(s.status, s.current_period_end) THEN 'basic'
      WHEN s.trial_end IS NOT NULL AND s.trial_end > now() THEN 'team'
      ELSE 'free'
    END AS tier,
    COALESCE(s.quantity, 1) AS quantity,
    COALESCE(s.billing_cycle, 'month') AS billing_cycle,
    COALESCE(s.status, 'none') AS status,
    s.trial_end,
    s.current_period_end
  FROM sub s
  RIGHT JOIN (SELECT 1) z ON true
$function$;