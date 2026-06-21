
-- 1. Preserve purchased (top-up) credits separately from cycle allowance.
ALTER TABLE public.account_credits
  ADD COLUMN IF NOT EXISTS purchased_credits integer NOT NULL DEFAULT 0;

-- Optional pending-downgrade marker for UI banner
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS downgrade_pending_at timestamptz;

-- 2. Lock anything beyond the new plan's limits as read-only.
-- Never delete. User picks which items stay active via set_*_active below.
CREATE OR REPLACE FUNCTION public.apply_plan_downgrade(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caps record;
  active_biz int;
  active_cal int;
BEGIN
  SELECT max_businesses, max_calendar_connections INTO caps
  FROM public.plan_limits(_user_id);

  -- Businesses: if cap is finite and active count exceeds cap, lock all extras.
  IF caps.max_businesses >= 0 THEN
    SELECT count(*) INTO active_biz
    FROM public.businesses
    WHERE owner_id = _user_id AND COALESCE(read_only,false) = false;
    IF active_biz > caps.max_businesses THEN
      UPDATE public.businesses
        SET read_only = true
        WHERE owner_id = _user_id AND COALESCE(read_only,false) = false;
      UPDATE public.profiles
        SET downgrade_pending_at = COALESCE(downgrade_pending_at, now())
        WHERE id = _user_id;
    END IF;
  END IF;

  -- Calendar connections (non-manual).
  IF caps.max_calendar_connections >= 0 THEN
    SELECT count(*) INTO active_cal
    FROM public.calendars
    WHERE owner_id = _user_id
      AND provider <> 'manual'
      AND COALESCE(read_only,false) = false;
    IF active_cal > caps.max_calendar_connections THEN
      UPDATE public.calendars
        SET read_only = true
        WHERE owner_id = _user_id
          AND provider <> 'manual'
          AND COALESCE(read_only,false) = false;
      UPDATE public.profiles
        SET downgrade_pending_at = COALESCE(downgrade_pending_at, now())
        WHERE id = _user_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_plan_downgrade(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_plan_downgrade(uuid) TO service_role;

-- 3. Clear all read-only flags when the user is back at or above the prior tier.
CREATE OR REPLACE FUNCTION public.clear_plan_locks(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caps record;
BEGIN
  SELECT max_businesses, max_calendar_connections INTO caps
  FROM public.plan_limits(_user_id);
  IF caps.max_businesses < 0 THEN
    UPDATE public.businesses SET read_only = false
      WHERE owner_id = _user_id AND COALESCE(read_only,false) = true;
  END IF;
  IF caps.max_calendar_connections < 0 THEN
    UPDATE public.calendars SET read_only = false
      WHERE owner_id = _user_id AND COALESCE(read_only,false) = true;
  END IF;
  UPDATE public.profiles SET downgrade_pending_at = NULL WHERE id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_plan_locks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.clear_plan_locks(uuid) TO service_role;

-- 4. User-facing toggles. Activating beyond cap is rejected, so the user
-- must lock another item first.
CREATE OR REPLACE FUNCTION public.set_business_active(_id uuid, _active boolean)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.businesses%ROWTYPE;
  caps record;
  active_cnt int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO row FROM public.businesses WHERE id = _id;
  IF NOT FOUND OR row.owner_id <> uid THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _active THEN
    SELECT max_businesses INTO caps FROM public.plan_limits(uid);
    IF caps.max_businesses >= 0 THEN
      SELECT count(*) INTO active_cnt
        FROM public.businesses
        WHERE owner_id = uid AND COALESCE(read_only,false) = false AND id <> _id;
      IF active_cnt >= caps.max_businesses THEN
        RAISE EXCEPTION 'UPGRADE_REQUIRED: Lock another business first or upgrade your plan.';
      END IF;
    END IF;
  END IF;

  UPDATE public.businesses SET read_only = NOT _active WHERE id = _id RETURNING * INTO row;

  -- Clear pending marker if everything is now within caps.
  PERFORM public.refresh_downgrade_pending(uid);
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_business_active(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_business_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_calendar_active(_id uuid, _active boolean)
RETURNS public.calendars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.calendars%ROWTYPE;
  caps record;
  active_cnt int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO row FROM public.calendars WHERE id = _id;
  IF NOT FOUND OR row.owner_id <> uid THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _active AND row.provider <> 'manual' THEN
    SELECT max_calendar_connections INTO caps FROM public.plan_limits(uid);
    IF caps.max_calendar_connections >= 0 THEN
      SELECT count(*) INTO active_cnt
        FROM public.calendars
        WHERE owner_id = uid
          AND provider <> 'manual'
          AND COALESCE(read_only,false) = false
          AND id <> _id;
      IF active_cnt >= caps.max_calendar_connections THEN
        RAISE EXCEPTION 'UPGRADE_REQUIRED: Lock another calendar first or upgrade your plan.';
      END IF;
    END IF;
  END IF;

  UPDATE public.calendars SET read_only = NOT _active WHERE id = _id RETURNING * INTO row;
  PERFORM public.refresh_downgrade_pending(uid);
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_calendar_active(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_calendar_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_downgrade_pending(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caps record;
  over_biz boolean := false;
  over_cal boolean := false;
  cnt int;
BEGIN
  SELECT max_businesses, max_calendar_connections INTO caps FROM public.plan_limits(_user_id);
  IF caps.max_businesses >= 0 THEN
    SELECT count(*) INTO cnt FROM public.businesses WHERE owner_id=_user_id AND COALESCE(read_only,false)=false;
    over_biz := cnt > caps.max_businesses;
  END IF;
  IF caps.max_calendar_connections >= 0 THEN
    SELECT count(*) INTO cnt FROM public.calendars WHERE owner_id=_user_id AND provider<>'manual' AND COALESCE(read_only,false)=false;
    over_cal := cnt > caps.max_calendar_connections;
  END IF;
  IF over_biz OR over_cal THEN
    UPDATE public.profiles SET downgrade_pending_at = COALESCE(downgrade_pending_at, now()) WHERE id=_user_id;
  ELSE
    UPDATE public.profiles SET downgrade_pending_at = NULL WHERE id=_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_downgrade_pending(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_downgrade_pending(uuid) TO authenticated, service_role;

-- 5. Cycle reset: resets allowance, preserves purchased credits.
CREATE OR REPLACE FUNCTION public.reset_cycle_allowance(
  _user_id uuid, _allowance int, _start timestamptz, _end timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.account_credits (
    account_user_id, allowance_credits, credit_balance,
    current_cycle_start, current_cycle_end, purchased_credits
  ) VALUES (_user_id, _allowance, _allowance, _start, _end, 0)
  ON CONFLICT (account_user_id) DO UPDATE
    SET allowance_credits = EXCLUDED.allowance_credits,
        credit_balance = EXCLUDED.allowance_credits,  -- allowance resets, no rollover
        current_cycle_start = EXCLUDED.current_cycle_start,
        current_cycle_end = EXCLUDED.current_cycle_end,
        updated_at = now();
    -- purchased_credits intentionally NOT touched
END;
$$;
REVOKE ALL ON FUNCTION public.reset_cycle_allowance(uuid,int,timestamptz,timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_cycle_allowance(uuid,int,timestamptz,timestamptz) TO service_role;

-- 6. Lifecycle sweeper. Run from a cron-protected endpoint.
CREATE OR REPLACE FUNCTION public.sweep_plan_lifecycle()
RETURNS TABLE(trial_expired int, past_due_dropped int, cancel_period_ended int, team_to_pro int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  c1 int := 0; c2 int := 0; c3 int := 0; c4 int := 0;
BEGIN
  -- Trial expired with no conversion.
  FOR r IN
    SELECT id, user_id FROM public.subscriptions
    WHERE status = 'trialing' AND trial_end IS NOT NULL AND trial_end < now()
  LOOP
    UPDATE public.subscriptions
      SET status='canceled', updated_at=now()
      WHERE id = r.id;
    PERFORM public.apply_plan_downgrade(r.user_id);
    c1 := c1 + 1;
  END LOOP;

  -- past_due longer than 3-day grace → drop to Free (mark canceled,
  -- never delete or suspend account data).
  FOR r IN
    SELECT id, user_id FROM public.subscriptions
    WHERE status = 'past_due'
      AND past_due_since IS NOT NULL
      AND past_due_since < now() - interval '3 days'
  LOOP
    UPDATE public.subscriptions
      SET status='canceled', updated_at=now()
      WHERE id = r.id;
    PERFORM public.apply_plan_downgrade(r.user_id);
    c2 := c2 + 1;
  END LOOP;

  -- Canceled and period has actually ended → apply downgrade lock now.
  FOR r IN
    SELECT id, user_id FROM public.subscriptions
    WHERE status = 'canceled'
      AND current_period_end IS NOT NULL
      AND current_period_end < now()
  LOOP
    PERFORM public.apply_plan_downgrade(r.user_id);
    c3 := c3 + 1;
  END LOOP;

  -- Team dropped below 2 seats → demote to Pro product locally.
  FOR r IN
    SELECT id, user_id FROM public.subscriptions
    WHERE status IN ('active','trialing')
      AND product_id = 'team_plan'
      AND quantity < 2
  LOOP
    UPDATE public.subscriptions
      SET product_id='pro_plan', quantity=1, updated_at=now()
      WHERE id = r.id;
    PERFORM public.apply_plan_downgrade(r.user_id);
    c4 := c4 + 1;
  END LOOP;

  RETURN QUERY SELECT c1, c2, c3, c4;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_plan_lifecycle() FROM public;
GRANT EXECUTE ON FUNCTION public.sweep_plan_lifecycle() TO service_role;
