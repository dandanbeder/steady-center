
-- Map basic_plan subscriptions to the new 'basic' tier.
CREATE OR REPLACE FUNCTION public.user_effective_plan(p_user uuid)
RETURNS TABLE(tier text, quantity int, billing_cycle text, status text, trial_end timestamptz, current_period_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
      WHEN s.trial_end IS NOT NULL AND s.trial_end > now() THEN 'pro'
      ELSE 'free'
    END AS tier,
    COALESCE(s.quantity, 1) AS quantity,
    COALESCE(s.billing_cycle, 'month') AS billing_cycle,
    COALESCE(s.status, 'none') AS status,
    s.trial_end,
    s.current_period_end
  FROM sub s
  RIGHT JOIN (SELECT 1) z ON true
$$;

-- Per-tier caps + AI allowances, single source of truth on the DB side.
CREATE OR REPLACE FUNCTION public.plan_limits(p_user uuid)
RETURNS TABLE (
  tier text,
  quantity int,
  paid_seats int,
  max_businesses int,
  max_calendar_connections int,
  sharing_enabled boolean,
  team_features_enabled boolean,
  ai_allowance_credits int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH p AS (
    SELECT * FROM public.user_effective_plan(p_user) LIMIT 1
  )
  SELECT
    p.tier,
    p.quantity,
    CASE WHEN p.tier = 'team' THEN GREATEST(p.quantity, 2) ELSE 1 END AS paid_seats,
    CASE p.tier
      WHEN 'free'  THEN 1
      WHEN 'basic' THEN 2
      WHEN 'pro'   THEN 4
      WHEN 'team'  THEN -1
      ELSE 1
    END AS max_businesses,
    CASE p.tier
      WHEN 'free' THEN 1
      ELSE -1
    END AS max_calendar_connections,
    (p.tier = 'team') AS sharing_enabled,
    (p.tier = 'team') AS team_features_enabled,
    CASE p.tier
      WHEN 'team'  THEN 400 * GREATEST(p.quantity, 2)
      WHEN 'pro'   THEN 400
      WHEN 'basic' THEN 300
      ELSE 25
    END AS ai_allowance_credits
  FROM p;
$$;

-- Calmer wording on the account-cap trigger (covers Free, Basic and Standard).
CREATE OR REPLACE FUNCTION public.businesses_enforce_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int;
  v_current int;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  SELECT max_businesses INTO v_cap FROM public.plan_limits(NEW.owner_id);
  IF v_cap IS NULL OR v_cap < 0 THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*)::int INTO v_current
    FROM public.businesses
   WHERE owner_id = NEW.owner_id;
  IF v_current >= v_cap THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: You''ve reached your plan''s accounts. Upgrade to add more.'
      USING ERRCODE = '42501', HINT = 'upgrade_required:businesses';
  END IF;
  RETURN NEW;
END $$;

-- Legacy enforcement function from the earlier migration, same calm copy.
CREATE OR REPLACE FUNCTION public.businesses_enforce_account_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_cap int;
  v_current int;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  SELECT tier, max_businesses INTO v_tier, v_cap FROM public.plan_limits(NEW.owner_id);
  IF v_cap IS NULL OR v_cap < 0 THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*)::int INTO v_current
    FROM public.businesses
   WHERE owner_id = NEW.owner_id;
  IF v_current >= v_cap THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: You''ve reached your plan''s accounts. Upgrade to add more.'
      USING ERRCODE = '42501', HINT = 'upgrade_required:businesses';
  END IF;
  RETURN NEW;
END $$;
