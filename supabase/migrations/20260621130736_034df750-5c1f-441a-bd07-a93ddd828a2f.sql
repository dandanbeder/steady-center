
-- ============================================================
-- A2: Server-side plan-limit enforcement + live usage counters
-- ============================================================
-- Mirrors src/lib/entitlements.ts LIMITS map. Triggers below are the
-- non-bypassable enforcement layer; server fns (requireAccountSlot,
-- requireCalendarSlot, requireFeature) call the same rules.

-- ---- Plan limits source of truth (DB-side mirror of LIMITS map) -----------
CREATE OR REPLACE FUNCTION public.plan_limits(p_user uuid)
RETURNS TABLE (
  tier text,
  quantity int,
  paid_seats int,
  max_businesses int,             -- -1 = unlimited
  max_calendar_connections int,   -- -1 = unlimited
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
    CASE p.tier WHEN 'free' THEN 1  ELSE -1 END AS max_businesses,
    CASE p.tier WHEN 'free' THEN 1  ELSE -1 END AS max_calendar_connections,
    (p.tier = 'team') AS sharing_enabled,
    (p.tier = 'team') AS team_features_enabled,
    CASE p.tier
      WHEN 'team' THEN 400 * GREATEST(p.quantity, 2)
      WHEN 'pro'  THEN 400
      ELSE 20
    END AS ai_allowance_credits
  FROM p;
$$;

REVOKE ALL ON FUNCTION public.plan_limits(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_limits(uuid) TO authenticated, service_role;

-- ---- account_usage: live counters per account owner -----------------------
CREATE TABLE IF NOT EXISTS public.account_usage (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  businesses_count int NOT NULL DEFAULT 0,
  calendar_connections_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_usage TO authenticated;
GRANT ALL ON public.account_usage TO service_role;

ALTER TABLE public.account_usage ENABLE ROW LEVEL SECURITY;

-- Owner reads own row; superadmin reads any. Writes go through triggers
-- using SECURITY DEFINER, so no INSERT/UPDATE/DELETE policy for end users.
CREATE POLICY "Owner reads own usage"
  ON public.account_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Superadmin reads all usage"
  ON public.account_usage FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ---- Counter maintenance --------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_account_usage(
  p_user uuid,
  p_biz int,
  p_cal int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO public.account_usage AS u (user_id, businesses_count, calendar_connections_count)
  VALUES (p_user, GREATEST(p_biz, 0), GREATEST(p_cal, 0))
  ON CONFLICT (user_id) DO UPDATE
    SET businesses_count = GREATEST(u.businesses_count + p_biz, 0),
        calendar_connections_count = GREATEST(u.calendar_connections_count + p_cal, 0),
        updated_at = now();
END $$;

-- Businesses counter trigger
CREATE OR REPLACE FUNCTION public.businesses_usage_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bump_account_usage(NEW.owner_id, 1, 0);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.bump_account_usage(OLD.owner_id, -1, 0);
  ELSIF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    PERFORM public.bump_account_usage(OLD.owner_id, -1, 0);
    PERFORM public.bump_account_usage(NEW.owner_id, 1, 0);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS businesses_usage_sync ON public.businesses;
CREATE TRIGGER businesses_usage_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_usage_sync();

-- Calendar-connections counter trigger (provider != 'manual')
CREATE OR REPLACE FUNCTION public.calendars_usage_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_counts boolean := TG_OP <> 'INSERT' AND OLD.provider IS DISTINCT FROM 'manual';
  new_counts boolean := TG_OP <> 'DELETE' AND NEW.provider IS DISTINCT FROM 'manual';
BEGIN
  IF TG_OP = 'INSERT' AND new_counts THEN
    PERFORM public.bump_account_usage(NEW.owner_id, 0, 1);
  ELSIF TG_OP = 'DELETE' AND old_counts THEN
    PERFORM public.bump_account_usage(OLD.owner_id, 0, -1);
  ELSIF TG_OP = 'UPDATE' THEN
    IF old_counts AND (NOT new_counts OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
      PERFORM public.bump_account_usage(OLD.owner_id, 0, -1);
    END IF;
    IF new_counts AND (NOT old_counts OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
      PERFORM public.bump_account_usage(NEW.owner_id, 0, 1);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS calendars_usage_sync ON public.calendars;
CREATE TRIGGER calendars_usage_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_usage_sync();

-- Backfill counters from current state
INSERT INTO public.account_usage (user_id, businesses_count, calendar_connections_count)
SELECT u.id,
       COALESCE(b.cnt, 0),
       COALESCE(c.cnt, 0)
FROM auth.users u
LEFT JOIN (
  SELECT owner_id, COUNT(*)::int AS cnt FROM public.businesses GROUP BY owner_id
) b ON b.owner_id = u.id
LEFT JOIN (
  SELECT owner_id, COUNT(*)::int AS cnt
  FROM public.calendars
  WHERE provider IS DISTINCT FROM 'manual'
  GROUP BY owner_id
) c ON c.owner_id = u.id
ON CONFLICT (user_id) DO UPDATE
  SET businesses_count = EXCLUDED.businesses_count,
      calendar_connections_count = EXCLUDED.calendar_connections_count,
      updated_at = now();

-- ---- Enforcement triggers: COUNT GATES ------------------------------------
-- Free plan: 1 business max. Pro/Team: unlimited. Service role bypasses.
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
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Free plan allows % business. Upgrade to add more.', v_cap
      USING ERRCODE = '42501', HINT = 'upgrade_required:businesses';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS businesses_enforce_limit ON public.businesses;
CREATE TRIGGER businesses_enforce_limit
  BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_enforce_limit();

-- Free plan: 1 calendar connection max (provider != 'manual'). Pro/Team: unlimited.
CREATE OR REPLACE FUNCTION public.calendars_enforce_connection_limit()
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
  IF NEW.provider IS NULL OR NEW.provider = 'manual' THEN
    RETURN NEW;
  END IF;
  SELECT max_calendar_connections INTO v_cap FROM public.plan_limits(NEW.owner_id);
  IF v_cap IS NULL OR v_cap < 0 THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*)::int INTO v_current
    FROM public.calendars
   WHERE owner_id = NEW.owner_id
     AND provider IS DISTINCT FROM 'manual';
  IF v_current >= v_cap THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Free plan allows % calendar connection. Upgrade to add more.', v_cap
      USING ERRCODE = '42501', HINT = 'upgrade_required:calendar_connections';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS calendars_enforce_connection_limit ON public.calendars;
CREATE TRIGGER calendars_enforce_connection_limit
  BEFORE INSERT ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_enforce_connection_limit();

-- ---- Enforcement triggers: FEATURE FLAGS ----------------------------------
-- Sharing (shares table inserts) requires sharing_enabled. The existing
-- shares_guard handles author/owner checks; we add a separate trigger
-- focused on plan gating.
CREATE OR REPLACE FUNCTION public.shares_enforce_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_sharing_enabled boolean;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT sharing_enabled INTO v_sharing_enabled FROM public.plan_limits(v_actor);
  IF NOT COALESCE(v_sharing_enabled, false) THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Sharing and collaboration require the Team plan.'
      USING ERRCODE = '42501', HINT = 'upgrade_required:sharing';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shares_enforce_plan ON public.shares;
CREATE TRIGGER shares_enforce_plan
  BEFORE INSERT ON public.shares
  FOR EACH ROW EXECUTE FUNCTION public.shares_enforce_plan();

-- Team-feature gating: invitations require team_features_enabled.
CREATE OR REPLACE FUNCTION public.invitations_enforce_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_team_enabled boolean;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  SELECT owner_id INTO v_owner FROM public.businesses WHERE id = NEW.business_id;
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT team_features_enabled INTO v_team_enabled FROM public.plan_limits(v_owner);
  IF NOT COALESCE(v_team_enabled, false) THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED: Inviting team members requires the Team plan.'
      USING ERRCODE = '42501', HINT = 'upgrade_required:team_features';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invitations_enforce_plan ON public.invitations;
CREATE TRIGGER invitations_enforce_plan
  BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.invitations_enforce_plan();
