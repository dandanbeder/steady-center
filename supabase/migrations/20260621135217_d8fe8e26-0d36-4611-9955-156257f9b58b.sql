
-- ============================================================
-- AI ECONOMICS: rollup tables, kitty ledger, admin RPCs
-- ============================================================

-- 1. Daily platform rollup ------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  day date PRIMARY KEY,
  true_cost_micros bigint NOT NULL DEFAULT 0,
  credits_charged bigint NOT NULL DEFAULT 0,
  events_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_usage_daily TO authenticated;
GRANT ALL ON public.ai_usage_daily TO service_role;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin reads ai_usage_daily"
  ON public.ai_usage_daily FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- 2. Per-account lifetime rollup ------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_account_totals (
  account_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  true_cost_micros bigint NOT NULL DEFAULT 0,
  credits_charged bigint NOT NULL DEFAULT 0,
  events_count integer NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_usage_account_totals TO authenticated;
GRANT ALL ON public.ai_usage_account_totals TO service_role;
ALTER TABLE public.ai_usage_account_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin reads ai_usage_account_totals"
  ON public.ai_usage_account_totals FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- 3. Kitty ledger ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_kitty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delta_micros bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fund','adjust')),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_kitty_ledger_created_idx
  ON public.ai_kitty_ledger (created_at DESC);
GRANT SELECT ON public.ai_kitty_ledger TO authenticated;
GRANT ALL ON public.ai_kitty_ledger TO service_role;
ALTER TABLE public.ai_kitty_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin reads ai_kitty_ledger"
  ON public.ai_kitty_ledger FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
-- Writes always go through admin_record_kitty_entry (SECURITY DEFINER).

-- Block client-side updates / deletes (append-only)
CREATE OR REPLACE FUNCTION public.ai_kitty_block_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_kitty_ledger is append-only';
END;
$$;
DROP TRIGGER IF EXISTS ai_kitty_no_update ON public.ai_kitty_ledger;
DROP TRIGGER IF EXISTS ai_kitty_no_delete ON public.ai_kitty_ledger;
CREATE TRIGGER ai_kitty_no_update BEFORE UPDATE ON public.ai_kitty_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ai_kitty_block_modify();
CREATE TRIGGER ai_kitty_no_delete BEFORE DELETE ON public.ai_kitty_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ai_kitty_block_modify();

-- 4. Trigger to keep rollups current --------------------------
CREATE OR REPLACE FUNCTION public.ai_usage_events_after_insert_rollup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  acct uuid;
BEGIN
  -- Resolve to billing account (team owner if pooled).
  acct := public.resolve_billing_account(NEW.user_id);

  INSERT INTO public.ai_usage_daily (day, true_cost_micros, credits_charged, events_count)
  VALUES (date_trunc('day', NEW.created_at)::date,
          NEW.true_cost_micros, NEW.credits_charged, 1)
  ON CONFLICT (day) DO UPDATE
    SET true_cost_micros = ai_usage_daily.true_cost_micros + EXCLUDED.true_cost_micros,
        credits_charged  = ai_usage_daily.credits_charged + EXCLUDED.credits_charged,
        events_count     = ai_usage_daily.events_count + 1,
        updated_at       = now();

  INSERT INTO public.ai_usage_account_totals
    (account_user_id, true_cost_micros, credits_charged, events_count, last_event_at)
  VALUES (acct, NEW.true_cost_micros, NEW.credits_charged, 1, NEW.created_at)
  ON CONFLICT (account_user_id) DO UPDATE
    SET true_cost_micros = ai_usage_account_totals.true_cost_micros + EXCLUDED.true_cost_micros,
        credits_charged  = ai_usage_account_totals.credits_charged + EXCLUDED.credits_charged,
        events_count     = ai_usage_account_totals.events_count + 1,
        last_event_at    = GREATEST(ai_usage_account_totals.last_event_at, EXCLUDED.last_event_at),
        updated_at       = now();

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_usage_events_rollup ON public.ai_usage_events;
CREATE TRIGGER trg_ai_usage_events_rollup
  AFTER INSERT ON public.ai_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_usage_events_after_insert_rollup();

-- 5. Backfill from existing events ----------------------------
INSERT INTO public.ai_usage_daily (day, true_cost_micros, credits_charged, events_count)
SELECT date_trunc('day', created_at)::date,
       COALESCE(SUM(true_cost_micros), 0),
       COALESCE(SUM(credits_charged), 0),
       COUNT(*)::int
FROM public.ai_usage_events
GROUP BY 1
ON CONFLICT (day) DO UPDATE
  SET true_cost_micros = EXCLUDED.true_cost_micros,
      credits_charged  = EXCLUDED.credits_charged,
      events_count     = EXCLUDED.events_count,
      updated_at       = now();

INSERT INTO public.ai_usage_account_totals
  (account_user_id, true_cost_micros, credits_charged, events_count, last_event_at)
SELECT public.resolve_billing_account(user_id) AS acct,
       COALESCE(SUM(true_cost_micros), 0),
       COALESCE(SUM(credits_charged), 0),
       COUNT(*)::int,
       MAX(created_at)
FROM public.ai_usage_events
GROUP BY acct
ON CONFLICT (account_user_id) DO UPDATE
  SET true_cost_micros = EXCLUDED.true_cost_micros,
      credits_charged  = EXCLUDED.credits_charged,
      events_count     = EXCLUDED.events_count,
      last_event_at    = EXCLUDED.last_event_at,
      updated_at       = now();

-- 6. admin_record_kitty_entry ---------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_kitty_entry(
  _delta_micros bigint,
  _kind text,
  _note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _kind NOT IN ('fund','adjust') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF _delta_micros = 0 THEN
    RAISE EXCEPTION 'delta must be non-zero';
  END IF;
  INSERT INTO public.ai_kitty_ledger (delta_micros, kind, note, created_by)
  VALUES (_delta_micros, _kind, _note, auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_kitty_entry(bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_record_kitty_entry(bigint,text,text)
  TO authenticated, service_role;

-- 7. admin_ai_economics_summary -------------------------------
-- Sell price per credit (imputed allowance revenue): 0.75¢ = 7500 micros.
CREATE OR REPLACE FUNCTION public.admin_ai_economics_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sell_per_credit_micros bigint := 7500;
  series jsonb;
  totals_30d jsonb;
  totals_alltime jsonb;
  revenue_30d jsonb;
  kitty jsonb;
  kitty_funded_micros bigint;
  kitty_consumed_micros bigint;
  kitty_consumed_30d_micros bigint;
  kitty_first_at timestamptz;
  daily_burn_micros bigint;
  runway_days numeric;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- 30-day daily series
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', day,
           'cost_micros', true_cost_micros,
           'credits_charged', credits_charged,
           'events_count', events_count
         ) ORDER BY day), '[]'::jsonb)
    INTO series
  FROM public.ai_usage_daily
  WHERE day >= (now() - interval '30 days')::date;

  -- 30-day totals
  SELECT jsonb_build_object(
           'cost_micros', COALESCE(SUM(true_cost_micros), 0),
           'credits_charged', COALESCE(SUM(credits_charged), 0),
           'events_count', COALESCE(SUM(events_count), 0)
         )
    INTO totals_30d
  FROM public.ai_usage_daily
  WHERE day >= (now() - interval '30 days')::date;

  -- All-time totals (for context)
  SELECT jsonb_build_object(
           'cost_micros', COALESCE(SUM(true_cost_micros), 0),
           'credits_charged', COALESCE(SUM(credits_charged), 0),
           'events_count', COALESCE(SUM(events_count), 0)
         )
    INTO totals_alltime
  FROM public.ai_usage_daily;

  -- Revenue (30d):
  --   * Allowance value: sum allowance_credits granted to active accounts × sell price.
  --     We treat each account's monthly allowance as recurring imputed AI revenue.
  --   * Top-up sales: sum amount_cents of credit_lots with a real paddle txn id
  --     (skip manual_/comp_/trial_ admin grants — they cost the platform, no revenue).
  WITH alw AS (
    SELECT COALESCE(SUM(allowance_credits), 0)::bigint AS allowance
    FROM public.account_credits
  ),
  topups AS (
    SELECT
      COUNT(*) FILTER (
        WHERE l.paddle_transaction_id IS NOT NULL
          AND l.paddle_transaction_id NOT LIKE 'manual\_%' ESCAPE '\'
          AND l.purchased_at >= now() - interval '30 days'
      ) AS purchases_30d,
      COALESCE(SUM(
        CASE WHEN l.paddle_transaction_id IS NOT NULL
              AND l.paddle_transaction_id NOT LIKE 'manual\_%' ESCAPE '\'
              AND l.purchased_at >= now() - interval '30 days'
          THEN COALESCE(p.amount_cents, 0) ELSE 0 END
      ), 0)::bigint AS revenue_30d_cents,
      COALESCE(SUM(
        CASE WHEN l.paddle_transaction_id IS NOT NULL
              AND l.paddle_transaction_id NOT LIKE 'manual\_%' ESCAPE '\'
          THEN COALESCE(p.amount_cents, 0) ELSE 0 END
      ), 0)::bigint AS revenue_alltime_cents
    FROM public.credit_lots l
    LEFT JOIN LATERAL (
      -- Map credits_initial → pack amount_cents from the hard-coded catalog
      SELECT amount_cents FROM (VALUES
        (500,    399),
        (2000,   1399),
        (5000,   2999),
        (12000,  5999)
      ) AS pack(credits, amount_cents)
      WHERE pack.credits = l.credits_initial
      LIMIT 1
    ) p ON true
  )
  SELECT jsonb_build_object(
           'allowance_value_micros_per_month', (SELECT allowance * sell_per_credit_micros FROM alw),
           'topup_revenue_30d_cents', (SELECT revenue_30d_cents FROM topups),
           'topup_revenue_alltime_cents', (SELECT revenue_alltime_cents FROM topups),
           'topup_purchases_30d', (SELECT purchases_30d FROM topups),
           'sell_per_credit_micros', sell_per_credit_micros
         )
    INTO revenue_30d;

  -- Kitty -----------------------------------------------------
  SELECT COALESCE(SUM(delta_micros), 0)::bigint, MIN(created_at)
    INTO kitty_funded_micros, kitty_first_at
  FROM public.ai_kitty_ledger;

  -- Consumed since the first ledger entry (so a fresh kitty starts at 0 consumed).
  SELECT COALESCE(SUM(true_cost_micros), 0)::bigint
    INTO kitty_consumed_micros
  FROM public.ai_usage_events
  WHERE kitty_first_at IS NULL OR created_at >= kitty_first_at;

  -- 30-day burn for runway
  SELECT COALESCE(SUM(true_cost_micros), 0)::bigint
    INTO kitty_consumed_30d_micros
  FROM public.ai_usage_daily
  WHERE day >= (now() - interval '30 days')::date;

  daily_burn_micros := CASE
    WHEN kitty_consumed_30d_micros > 0 THEN kitty_consumed_30d_micros / 30
    ELSE 0
  END;

  runway_days := CASE
    WHEN daily_burn_micros > 0
      THEN GREATEST(0, (kitty_funded_micros - kitty_consumed_micros))::numeric / daily_burn_micros
    ELSE NULL
  END;

  kitty := jsonb_build_object(
    'funded_micros', kitty_funded_micros,
    'consumed_micros', LEAST(kitty_consumed_micros, kitty_funded_micros),
    'consumed_raw_micros', kitty_consumed_micros,
    'remaining_micros', GREATEST(0, kitty_funded_micros - kitty_consumed_micros),
    'daily_burn_micros', daily_burn_micros,
    'runway_days', runway_days,
    'first_funded_at', kitty_first_at,
    'low_kitty_alert', (
      kitty_funded_micros > 0
      AND (
        runway_days IS NOT NULL AND runway_days < 30
        OR (kitty_funded_micros - kitty_consumed_micros)::numeric / NULLIF(kitty_funded_micros,0) < 0.2
      )
    )
  );

  RETURN jsonb_build_object(
    'series_30d', series,
    'totals_30d', totals_30d,
    'totals_alltime', totals_alltime,
    'revenue', revenue_30d,
    'kitty', kitty,
    'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_economics_summary() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_ai_economics_summary()
  TO authenticated, service_role;

-- 8. admin_ai_per_account_economics ---------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_per_account_economics()
RETURNS TABLE(
  account_user_id uuid,
  email text,
  full_name text,
  allowance_credits integer,
  allowance_used integer,
  allowance_pct numeric,
  purchased_credits integer,
  topup_paused boolean,
  total_cost_micros bigint,
  total_credits_charged bigint,
  events_count integer,
  last_event_at timestamptz,
  topup_revenue_cents bigint,
  over_80 boolean,
  hard_stopped boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  WITH topups AS (
    SELECT
      l.account_user_id,
      COALESCE(SUM(
        CASE WHEN l.paddle_transaction_id IS NOT NULL
              AND l.paddle_transaction_id NOT LIKE 'manual\_%' ESCAPE '\'
          THEN COALESCE(p.amount_cents, 0) ELSE 0 END
      ), 0)::bigint AS revenue_cents
    FROM public.credit_lots l
    LEFT JOIN LATERAL (
      SELECT amount_cents FROM (VALUES
        (500, 399), (2000, 1399), (5000, 2999), (12000, 5999)
      ) AS pack(credits, amount_cents)
      WHERE pack.credits = l.credits_initial
      LIMIT 1
    ) p ON true
    GROUP BY l.account_user_id
  )
  SELECT
    ac.account_user_id,
    COALESCE(au.email::text, '')                     AS email,
    COALESCE(pr.full_name, '')                       AS full_name,
    ac.allowance_credits,
    GREATEST(0, ac.allowance_credits - ac.credit_balance) AS allowance_used,
    CASE WHEN ac.allowance_credits > 0
      THEN ROUND(((ac.allowance_credits - ac.credit_balance)::numeric * 100) / ac.allowance_credits, 1)
      ELSE 0 END                                     AS allowance_pct,
    ac.purchased_credits,
    ac.topup_paused,
    COALESCE(t.true_cost_micros, 0)                  AS total_cost_micros,
    COALESCE(t.credits_charged, 0)                   AS total_credits_charged,
    COALESCE(t.events_count, 0)                      AS events_count,
    t.last_event_at,
    COALESCE(tp.revenue_cents, 0)                    AS topup_revenue_cents,
    (ac.allowance_credits > 0
      AND (ac.allowance_credits - ac.credit_balance)::numeric
          / ac.allowance_credits > 0.8)              AS over_80,
    (ac.topup_paused AND ac.purchased_credits = 0)   AS hard_stopped
  FROM public.account_credits ac
  LEFT JOIN public.ai_usage_account_totals t
    ON t.account_user_id = ac.account_user_id
  LEFT JOIN topups tp
    ON tp.account_user_id = ac.account_user_id
  LEFT JOIN public.profiles pr ON pr.id = ac.account_user_id
  LEFT JOIN auth.users au ON au.id = ac.account_user_id
  ORDER BY COALESCE(t.true_cost_micros, 0) DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_per_account_economics() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_ai_per_account_economics()
  TO authenticated, service_role;
