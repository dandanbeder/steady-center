
-- =============================================================
-- Rollup tables (read by the dashboard; written by the cron job)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.analytics_daily_metrics (
  day date PRIMARY KEY,
  signups int NOT NULL DEFAULT 0,
  logins int NOT NULL DEFAULT 0,
  accounts_created int NOT NULL DEFAULT 0,
  calendars_connected int NOT NULL DEFAULT 0,
  tasks_created int NOT NULL DEFAULT 0,
  notes_created int NOT NULL DEFAULT 0,
  meetings_created int NOT NULL DEFAULT 0,
  ai_actions int NOT NULL DEFAULT 0,
  trial_started int NOT NULL DEFAULT 0,
  trial_converted int NOT NULL DEFAULT 0,
  subscription_canceled int NOT NULL DEFAULT 0,
  payment_failed int NOT NULL DEFAULT 0,
  dau int NOT NULL DEFAULT 0,
  wau int NOT NULL DEFAULT 0,
  mau int NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.analytics_daily_metrics TO authenticated;
GRANT ALL ON public.analytics_daily_metrics TO service_role;
ALTER TABLE public.analytics_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superadmins read daily metrics"
  ON public.analytics_daily_metrics FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_analytics_daily_metrics_day ON public.analytics_daily_metrics (day DESC);

CREATE TABLE IF NOT EXISTS public.analytics_subscription_snapshots (
  day date PRIMARY KEY,
  free_users int NOT NULL DEFAULT 0,
  pro_users int NOT NULL DEFAULT 0,
  team_users int NOT NULL DEFAULT 0,
  trialing int NOT NULL DEFAULT 0,
  past_due int NOT NULL DEFAULT 0,
  canceled int NOT NULL DEFAULT 0,
  team_seats_sold int NOT NULL DEFAULT 0,
  mrr_pro_cents bigint NOT NULL DEFAULT 0,
  mrr_team_cents bigint NOT NULL DEFAULT 0,
  mrr_total_cents bigint NOT NULL DEFAULT 0,
  monthly_subs int NOT NULL DEFAULT 0,
  annual_subs int NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.analytics_subscription_snapshots TO authenticated;
GRANT ALL ON public.analytics_subscription_snapshots TO service_role;
ALTER TABLE public.analytics_subscription_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superadmins read sub snapshots"
  ON public.analytics_subscription_snapshots FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_analytics_sub_snapshots_day ON public.analytics_subscription_snapshots (day DESC);

-- =============================================================
-- Refresh function: per-day metrics (idempotent upsert)
-- Prices are hard-coded to match src/lib/entitlements.ts PRICING.
-- Adjust here if PRICING changes.
-- =============================================================
CREATE OR REPLACE FUNCTION public.refresh_analytics_for_day(p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d_start timestamptz := p_day::timestamptz;
  d_end timestamptz := (p_day + 1)::timestamptz;
  w_start timestamptz := d_end - interval '7 days';
  m_start timestamptz := d_end - interval '30 days';
  v_signups int; v_logins int; v_accounts int; v_calendars int;
  v_tasks int; v_notes int; v_meetings int; v_ai int;
  v_trial_started int; v_trial_converted int;
  v_canceled int; v_payment_failed int;
  v_dau int; v_wau int; v_mau int;
BEGIN
  SELECT
    COALESCE(SUM((type='signup')::int),0),
    COALESCE(SUM((type='login')::int),0),
    COALESCE(SUM((type='account_created')::int),0),
    COALESCE(SUM((type='calendar_connected')::int),0),
    COALESCE(SUM((type='task_created')::int),0),
    COALESCE(SUM((type='note_created')::int),0),
    COALESCE(SUM((type='meeting_created')::int),0),
    COALESCE(SUM(CASE WHEN type='ai_action_used' THEN COALESCE((metadata->>'delta')::int,1) ELSE 0 END),0),
    COALESCE(SUM((type='trial_started')::int),0),
    COALESCE(SUM((type='trial_converted')::int),0),
    COALESCE(SUM((type='subscription_canceled')::int),0),
    COALESCE(SUM((type='payment_failed')::int),0)
  INTO v_signups, v_logins, v_accounts, v_calendars, v_tasks, v_notes, v_meetings, v_ai,
       v_trial_started, v_trial_converted, v_canceled, v_payment_failed
  FROM public.analytics_events
  WHERE created_at >= d_start AND created_at < d_end;

  SELECT COUNT(DISTINCT user_id) INTO v_dau FROM public.analytics_events
    WHERE type='login' AND created_at >= d_start AND created_at < d_end AND user_id IS NOT NULL;
  SELECT COUNT(DISTINCT user_id) INTO v_wau FROM public.analytics_events
    WHERE type='login' AND created_at >= w_start AND created_at < d_end AND user_id IS NOT NULL;
  SELECT COUNT(DISTINCT user_id) INTO v_mau FROM public.analytics_events
    WHERE type='login' AND created_at >= m_start AND created_at < d_end AND user_id IS NOT NULL;

  INSERT INTO public.analytics_daily_metrics
    (day, signups, logins, accounts_created, calendars_connected,
     tasks_created, notes_created, meetings_created, ai_actions,
     trial_started, trial_converted, subscription_canceled, payment_failed,
     dau, wau, mau, refreshed_at)
  VALUES (p_day, v_signups, v_logins, v_accounts, v_calendars,
          v_tasks, v_notes, v_meetings, v_ai,
          v_trial_started, v_trial_converted, v_canceled, v_payment_failed,
          v_dau, v_wau, v_mau, now())
  ON CONFLICT (day) DO UPDATE SET
    signups = EXCLUDED.signups, logins = EXCLUDED.logins,
    accounts_created = EXCLUDED.accounts_created,
    calendars_connected = EXCLUDED.calendars_connected,
    tasks_created = EXCLUDED.tasks_created, notes_created = EXCLUDED.notes_created,
    meetings_created = EXCLUDED.meetings_created, ai_actions = EXCLUDED.ai_actions,
    trial_started = EXCLUDED.trial_started, trial_converted = EXCLUDED.trial_converted,
    subscription_canceled = EXCLUDED.subscription_canceled,
    payment_failed = EXCLUDED.payment_failed,
    dau = EXCLUDED.dau, wau = EXCLUDED.wau, mau = EXCLUDED.mau,
    refreshed_at = now();
END $$;

-- Refresh subscription snapshot (totals as of end of given day)
CREATE OR REPLACE FUNCTION public.refresh_subscription_snapshot_for_day(p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := (p_day + 1)::timestamptz;
  v_pro int; v_team int; v_free int;
  v_trialing int; v_past_due int; v_canceled int;
  v_seats int;
  v_mrr_pro bigint; v_mrr_team bigint;
  v_monthly int; v_annual int;
  v_total_users int;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (s.user_id) s.*
      FROM public.subscriptions s
     WHERE s.environment = 'live'
       AND s.created_at < cutoff
     ORDER BY s.user_id, s.created_at DESC
  ),
  active AS (
    SELECT * FROM latest
     WHERE (status IN ('active','trialing','past_due')
            AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
  )
  SELECT
    COALESCE(SUM((product_id='pro_plan')::int),0),
    COALESCE(SUM((product_id='team_plan')::int),0),
    COALESCE(SUM((status='trialing')::int),0),
    COALESCE(SUM((status='past_due')::int),0),
    COALESCE(SUM((status='canceled')::int),0),
    COALESCE(SUM(CASE WHEN product_id='team_plan' THEN COALESCE(quantity,1) ELSE 0 END),0),
    COALESCE(SUM(CASE
      WHEN product_id='pro_plan' AND billing_cycle='month' THEN 1000
      WHEN product_id='pro_plan' AND billing_cycle='year'  THEN 9600 / 12
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN product_id='team_plan' AND billing_cycle='month' THEN 1200 * COALESCE(quantity,1)
      WHEN product_id='team_plan' AND billing_cycle='year'  THEN (12000 * COALESCE(quantity,1)) / 12
      ELSE 0 END), 0),
    COALESCE(SUM((billing_cycle='month')::int),0),
    COALESCE(SUM((billing_cycle='year')::int),0)
  INTO v_pro, v_team, v_trialing, v_past_due, v_canceled, v_seats,
       v_mrr_pro, v_mrr_team, v_monthly, v_annual
  FROM active;

  SELECT COUNT(*) INTO v_total_users FROM public.profiles WHERE created_at < cutoff;
  v_free := GREATEST(v_total_users - v_pro - v_team, 0);

  INSERT INTO public.analytics_subscription_snapshots
    (day, free_users, pro_users, team_users, trialing, past_due, canceled,
     team_seats_sold, mrr_pro_cents, mrr_team_cents, mrr_total_cents,
     monthly_subs, annual_subs, refreshed_at)
  VALUES (p_day, v_free, v_pro, v_team, v_trialing, v_past_due, v_canceled,
          v_seats, v_mrr_pro, v_mrr_team, v_mrr_pro + v_mrr_team,
          v_monthly, v_annual, now())
  ON CONFLICT (day) DO UPDATE SET
    free_users = EXCLUDED.free_users, pro_users = EXCLUDED.pro_users,
    team_users = EXCLUDED.team_users, trialing = EXCLUDED.trialing,
    past_due = EXCLUDED.past_due, canceled = EXCLUDED.canceled,
    team_seats_sold = EXCLUDED.team_seats_sold,
    mrr_pro_cents = EXCLUDED.mrr_pro_cents,
    mrr_team_cents = EXCLUDED.mrr_team_cents,
    mrr_total_cents = EXCLUDED.mrr_total_cents,
    monthly_subs = EXCLUDED.monthly_subs,
    annual_subs = EXCLUDED.annual_subs,
    refreshed_at = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.refresh_analytics_for_day(date) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_subscription_snapshot_for_day(date) FROM anon, authenticated, PUBLIC;

-- Backfill the last 60 days so the dashboard isn't empty on first load
DO $$
DECLARE i int;
BEGIN
  FOR i IN 0..60 LOOP
    PERFORM public.refresh_analytics_for_day((current_date - i)::date);
    PERFORM public.refresh_subscription_snapshot_for_day((current_date - i)::date);
  END LOOP;
END $$;

-- =============================================================
-- Cron: refresh today + yesterday every day at 02:10 UTC
-- =============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('analytics-daily-refresh');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'analytics-daily-refresh',
  '10 2 * * *',
  $$
    SELECT public.refresh_analytics_for_day(current_date);
    SELECT public.refresh_analytics_for_day((current_date - 1));
    SELECT public.refresh_subscription_snapshot_for_day(current_date);
    SELECT public.refresh_subscription_snapshot_for_day((current_date - 1));
  $$
);
