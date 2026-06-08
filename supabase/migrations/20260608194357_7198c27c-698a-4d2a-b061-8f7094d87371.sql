
-- Enforce per-account/calendar limits on insert based on owner's effective plan.
-- service_role bypasses so webhooks and admin restores still work.

CREATE OR REPLACE FUNCTION public.businesses_enforce_account_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_count int;
  v_cap int;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier FROM public.user_effective_plan(NEW.owner_id);
  v_cap := CASE v_tier
    WHEN 'free' THEN 1
    ELSE -1
  END;
  IF v_cap < 0 THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.businesses WHERE owner_id = NEW.owner_id;
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Free plan allows % account. Upgrade to add more.', v_cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_businesses_enforce_account_limit ON public.businesses;
CREATE TRIGGER trg_businesses_enforce_account_limit
  BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_enforce_account_limit();


CREATE OR REPLACE FUNCTION public.calendars_enforce_connection_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_count int;
  v_cap int;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Only count real provider connections; manual calendars are unlimited.
  IF NEW.provider IS NULL OR NEW.provider = 'manual' THEN
    RETURN NEW;
  END IF;
  SELECT tier INTO v_tier FROM public.user_effective_plan(NEW.owner_id);
  v_cap := CASE v_tier
    WHEN 'free' THEN 1
    ELSE -1
  END;
  IF v_cap < 0 THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.calendars
    WHERE owner_id = NEW.owner_id
      AND provider IS NOT NULL
      AND provider <> 'manual';
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Free plan allows % calendar connection. Upgrade to add more.', v_cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_calendars_enforce_connection_limit ON public.calendars;
CREATE TRIGGER trg_calendars_enforce_connection_limit
  BEFORE INSERT ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_enforce_connection_limit();
