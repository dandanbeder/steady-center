
-- 1. Subscription shape
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS quantity int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'month' CHECK (billing_cycle IN ('month','year')),
  ADD COLUMN IF NOT EXISTS trial_end timestamptz;

-- 2. AI actions counter (separate from $ counter)
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS actions int NOT NULL DEFAULT 0;

-- 3. Read-only flags for downgrades
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.calendars
  ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false;

-- 4. Active-subscription helper (used by user_effective_plan below)
CREATE OR REPLACE FUNCTION public.is_sub_active(p_status text, p_period_end timestamptz)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT (p_status IN ('active','trialing','past_due') AND (p_period_end IS NULL OR p_period_end > now()))
      OR (p_status = 'canceled' AND p_period_end IS NOT NULL AND p_period_end > now())
$$;
GRANT EXECUTE ON FUNCTION public.is_sub_active(text, timestamptz) TO authenticated, service_role;

-- 5. Paid-seat count
CREATE OR REPLACE FUNCTION public.paid_seat_count(p_business uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::int
    FROM public.memberships
   WHERE business_id = p_business
     AND status = 'active'
     AND role::text IN ('owner','admin','member')
$$;
GRANT EXECUTE ON FUNCTION public.paid_seat_count(uuid) TO authenticated, service_role;

-- 6. Effective plan for a user (owner perspective)
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
      WHEN s.product_id = 'team_plan' AND public.is_sub_active(s.status, s.current_period_end) THEN 'team'
      WHEN s.product_id = 'pro_plan'  AND public.is_sub_active(s.status, s.current_period_end) THEN 'pro'
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
GRANT EXECUTE ON FUNCTION public.user_effective_plan(uuid) TO authenticated, service_role;

-- 7. Seat-enforcement trigger
CREATE OR REPLACE FUNCTION public.memberships_enforce_seats()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_tier text;
  v_quantity int;
  v_paid_after int;
  v_is_paid_role boolean;
  v_was_paid boolean;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  v_is_paid_role := NEW.role::text IN ('owner','admin','member');
  v_was_paid := TG_OP = 'UPDATE' AND OLD.role::text IN ('owner','admin','member') AND OLD.status = 'active';

  IF NOT v_is_paid_role OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF v_was_paid AND OLD.business_id = NEW.business_id AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner FROM public.businesses WHERE id = NEW.business_id;

  IF NEW.user_id IS NOT NULL AND NEW.user_id = v_owner THEN
    RETURN NEW;
  END IF;

  SELECT tier, quantity INTO v_tier, v_quantity
    FROM public.user_effective_plan(v_owner) LIMIT 1;

  IF v_tier <> 'team' THEN
    RAISE EXCEPTION 'TEAM_PLAN_REQUIRED' USING HINT = 'Upgrade to the Team plan to add paid members.';
  END IF;

  SELECT COUNT(*)::int INTO v_paid_after
    FROM public.memberships m
   WHERE m.business_id = NEW.business_id
     AND m.status = 'active'
     AND m.role::text IN ('owner','admin','member')
     AND (TG_OP = 'INSERT' OR m.id <> NEW.id);
  v_paid_after := v_paid_after + 1;

  IF v_paid_after > v_quantity THEN
    RAISE EXCEPTION 'SEAT_LIMIT_REACHED' USING HINT = format('You have %s paid seats. Add a seat first.', v_quantity);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_memberships_enforce_seats ON public.memberships;
CREATE TRIGGER trg_memberships_enforce_seats
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_enforce_seats();
