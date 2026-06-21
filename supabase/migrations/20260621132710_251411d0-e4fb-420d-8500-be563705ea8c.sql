-- Cost-anchored AI credits: credit lots, ledger, charge/topup/expire functions.

-- 1. Extend account_credits with alerting & pause flags.
ALTER TABLE public.account_credits
  ADD COLUMN IF NOT EXISTS low_balance_threshold integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS low_balance_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS topup_paused boolean NOT NULL DEFAULT false;

-- 2. Credit lots (rolling 12-month top-up packs, oldest expiry spent first).
CREATE TABLE IF NOT EXISTS public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_remaining integer NOT NULL CHECK (credits_remaining >= 0),
  credits_initial integer NOT NULL CHECK (credits_initial > 0),
  paddle_transaction_id text UNIQUE,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_lots_account_expiry_idx
  ON public.credit_lots (account_user_id, expires_at)
  WHERE credits_remaining > 0;

GRANT SELECT ON public.credit_lots TO authenticated;
GRANT ALL ON public.credit_lots TO service_role;

ALTER TABLE public.credit_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own credit lots"
  ON public.credit_lots FOR SELECT
  TO authenticated
  USING (account_user_id = auth.uid() OR public.is_platform_admin());

CREATE TRIGGER trg_credit_lots_touch
  BEFORE UPDATE ON public.credit_lots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Credit ledger (audit log for every grant / spend).
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acting_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  source text NOT NULL CHECK (source IN
    ('allowance','purchased','topup','cycle_reset','admin_grant','refund','expire','hard_stop')),
  ai_usage_event_id uuid REFERENCES public.ai_usage_events(id) ON DELETE SET NULL,
  balance_after_allowance integer NOT NULL,
  balance_after_purchased integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_account_time_idx
  ON public.credit_ledger (account_user_id, created_at DESC);

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own credit ledger"
  ON public.credit_ledger FOR SELECT
  TO authenticated
  USING (account_user_id = auth.uid() OR public.is_platform_admin());

-- 4. resolve_billing_account: pooled balances for Team plans.
CREATE OR REPLACE FUNCTION public.resolve_billing_account(_user uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_id uuid;
BEGIN
  -- Find an active paid-role membership where the business owner has a live team subscription.
  SELECT om.user_id INTO owner_id
  FROM public.memberships m
  JOIN public.memberships om
    ON om.business_id = m.business_id AND om.role = 'owner' AND om.status = 'active'
  JOIN public.subscriptions s
    ON s.user_id = om.user_id
    AND s.product_id = 'team_plan'
    AND s.status IN ('active','trialing','past_due')
  WHERE m.user_id = _user
    AND m.status = 'active'
    AND m.role IN ('owner','admin','member')
  ORDER BY s.created_at DESC
  LIMIT 1;

  RETURN COALESCE(owner_id, _user);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_billing_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_billing_account(uuid) TO authenticated, service_role;

-- 5. expire_credit_lots: zero out expired lots, sync purchased_credits.
CREATE OR REPLACE FUNCTION public.expire_credit_lots()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
  new_pur integer;
  new_allow integer;
BEGIN
  FOR r IN
    SELECT id, account_user_id, credits_remaining
    FROM public.credit_lots
    WHERE credits_remaining > 0 AND expires_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.account_credits
      SET purchased_credits = GREATEST(purchased_credits - r.credits_remaining, 0),
          updated_at = now()
      WHERE account_user_id = r.account_user_id
      RETURNING credit_balance, purchased_credits INTO new_allow, new_pur;

    INSERT INTO public.credit_ledger
      (account_user_id, acting_user_id, delta, source,
       balance_after_allowance, balance_after_purchased, note)
    VALUES
      (r.account_user_id, r.account_user_id, -r.credits_remaining, 'expire',
       COALESCE(new_allow, 0), COALESCE(new_pur, 0),
       'lot ' || r.id::text || ' expired');

    UPDATE public.credit_lots
      SET credits_remaining = 0, updated_at = now()
      WHERE id = r.id;

    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_credit_lots() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_credit_lots() TO service_role;

-- 6. charge_ai_credits: spend allowance first, then purchased lots; hard-stop on empty.
CREATE OR REPLACE FUNCTION public.charge_ai_credits(
  _acting_user uuid,
  _credits integer,
  _event_id uuid
) RETURNS TABLE(billing_account uuid, allowance_after integer, purchased_after integer, hard_stopped boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  billing uuid;
  ac record;
  remaining integer;
  from_allowance integer := 0;
  from_purchased integer := 0;
  lot record;
  take integer;
  thr integer;
  hard boolean := false;
BEGIN
  IF _credits IS NULL OR _credits <= 0 THEN
    _credits := 1;
  END IF;

  billing := public.resolve_billing_account(_acting_user);

  -- Lazy-create the account_credits row so first-ever charge doesn't NPE.
  INSERT INTO public.account_credits (account_user_id, allowance_credits, credit_balance)
  VALUES (billing, 0, 0)
  ON CONFLICT (account_user_id) DO NOTHING;

  SELECT * INTO ac FROM public.account_credits
    WHERE account_user_id = billing FOR UPDATE;

  IF (ac.credit_balance + ac.purchased_credits) < _credits THEN
    -- HARD STOP: insufficient. Pause AI, log, return without debiting.
    UPDATE public.account_credits
      SET topup_paused = true, updated_at = now()
      WHERE account_user_id = billing;

    INSERT INTO public.credit_ledger
      (account_user_id, acting_user_id, delta, source, ai_usage_event_id,
       balance_after_allowance, balance_after_purchased, note)
    VALUES
      (billing, _acting_user, -_credits, 'hard_stop', _event_id,
       ac.credit_balance, ac.purchased_credits,
       'insufficient credits (needed ' || _credits || ')');

    RETURN QUERY SELECT billing, ac.credit_balance, ac.purchased_credits, true;
    RETURN;
  END IF;

  remaining := _credits;

  -- Spend from allowance first.
  IF ac.credit_balance > 0 AND remaining > 0 THEN
    from_allowance := LEAST(ac.credit_balance, remaining);
    UPDATE public.account_credits
      SET credit_balance = credit_balance - from_allowance, updated_at = now()
      WHERE account_user_id = billing;
    remaining := remaining - from_allowance;
  END IF;

  -- Spend remaining from purchased lots, oldest expiry first.
  IF remaining > 0 THEN
    FOR lot IN
      SELECT id, credits_remaining FROM public.credit_lots
      WHERE account_user_id = billing
        AND credits_remaining > 0
        AND expires_at > now()
      ORDER BY expires_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN remaining = 0;
      take := LEAST(lot.credits_remaining, remaining);
      UPDATE public.credit_lots
        SET credits_remaining = credits_remaining - take, updated_at = now()
        WHERE id = lot.id;
      from_purchased := from_purchased + take;
      remaining := remaining - take;
    END LOOP;
    IF from_purchased > 0 THEN
      UPDATE public.account_credits
        SET purchased_credits = GREATEST(purchased_credits - from_purchased, 0),
            updated_at = now()
        WHERE account_user_id = billing;
    END IF;
  END IF;

  -- Reload final balances.
  SELECT * INTO ac FROM public.account_credits WHERE account_user_id = billing;

  -- Ledger rows per source touched.
  IF from_allowance > 0 THEN
    INSERT INTO public.credit_ledger
      (account_user_id, acting_user_id, delta, source, ai_usage_event_id,
       balance_after_allowance, balance_after_purchased)
    VALUES
      (billing, _acting_user, -from_allowance, 'allowance', _event_id,
       ac.credit_balance, ac.purchased_credits);
  END IF;
  IF from_purchased > 0 THEN
    INSERT INTO public.credit_ledger
      (account_user_id, acting_user_id, delta, source, ai_usage_event_id,
       balance_after_allowance, balance_after_purchased)
    VALUES
      (billing, _acting_user, -from_purchased, 'purchased', _event_id,
       ac.credit_balance, ac.purchased_credits);
  END IF;

  -- Low-balance alert.
  thr := COALESCE(ac.low_balance_threshold, 20);
  IF (ac.credit_balance + ac.purchased_credits) <= thr
     AND (ac.low_balance_alerted_at IS NULL
          OR (ac.current_cycle_start IS NOT NULL
              AND ac.low_balance_alerted_at < ac.current_cycle_start))
  THEN
    UPDATE public.account_credits
      SET low_balance_alerted_at = now(), updated_at = now()
      WHERE account_user_id = billing;
  END IF;

  RETURN QUERY SELECT billing, ac.credit_balance, ac.purchased_credits, false;
END;
$$;
REVOKE ALL ON FUNCTION public.charge_ai_credits(uuid,integer,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.charge_ai_credits(uuid,integer,uuid) TO service_role;

-- 7. add_purchased_credits: idempotent top-up grant.
CREATE OR REPLACE FUNCTION public.add_purchased_credits(
  _user uuid, _credits integer, _months integer, _paddle_tx text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  exists_lot uuid;
  new_pur integer;
  new_allow integer;
BEGIN
  IF _credits IS NULL OR _credits <= 0 THEN RETURN; END IF;

  IF _paddle_tx IS NOT NULL THEN
    SELECT id INTO exists_lot FROM public.credit_lots
      WHERE paddle_transaction_id = _paddle_tx;
    IF exists_lot IS NOT NULL THEN RETURN; END IF;
  END IF;

  INSERT INTO public.account_credits (account_user_id, allowance_credits, credit_balance, purchased_credits)
  VALUES (_user, 0, 0, 0)
  ON CONFLICT (account_user_id) DO NOTHING;

  INSERT INTO public.credit_lots
    (account_user_id, credits_remaining, credits_initial, paddle_transaction_id, expires_at)
  VALUES
    (_user, _credits, _credits, _paddle_tx, now() + (_months || ' months')::interval);

  UPDATE public.account_credits
    SET purchased_credits = purchased_credits + _credits,
        topup_paused = false,
        updated_at = now()
    WHERE account_user_id = _user
    RETURNING credit_balance, purchased_credits INTO new_allow, new_pur;

  INSERT INTO public.credit_ledger
    (account_user_id, acting_user_id, delta, source,
     balance_after_allowance, balance_after_purchased, note)
  VALUES
    (_user, _user, _credits, 'topup',
     COALESCE(new_allow,0), COALESCE(new_pur,0),
     COALESCE('paddle_tx=' || _paddle_tx, 'manual'));
END;
$$;
REVOKE ALL ON FUNCTION public.add_purchased_credits(uuid,integer,integer,text) FROM public;
GRANT EXECUTE ON FUNCTION public.add_purchased_credits(uuid,integer,integer,text) TO service_role;

-- 8. Replace reset_cycle_allowance: clear alert/pause + ledger row.
CREATE OR REPLACE FUNCTION public.reset_cycle_allowance(
  _user_id uuid, _allowance int, _start timestamptz, _end timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_pur integer;
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
        low_balance_alerted_at = NULL,
        topup_paused = false,
        updated_at = now();

  SELECT purchased_credits INTO new_pur FROM public.account_credits
    WHERE account_user_id = _user_id;

  INSERT INTO public.credit_ledger
    (account_user_id, acting_user_id, delta, source,
     balance_after_allowance, balance_after_purchased, note)
  VALUES
    (_user_id, _user_id, _allowance, 'cycle_reset',
     _allowance, COALESCE(new_pur, 0), 'billing anniversary');
END;
$$;
REVOKE ALL ON FUNCTION public.reset_cycle_allowance(uuid,int,timestamptz,timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_cycle_allowance(uuid,int,timestamptz,timestamptz) TO service_role;

-- 9. set_low_balance_threshold: user can change their alert threshold.
CREATE OR REPLACE FUNCTION public.set_low_balance_threshold(_threshold integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  billing uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _threshold < 0 OR _threshold > 100000 THEN
    RAISE EXCEPTION 'threshold out of range';
  END IF;
  billing := public.resolve_billing_account(auth.uid());
  -- Only the billing-account owner can change their own threshold.
  IF billing <> auth.uid() THEN
    RAISE EXCEPTION 'only the billing account owner can change the threshold';
  END IF;
  INSERT INTO public.account_credits (account_user_id, low_balance_threshold)
  VALUES (billing, _threshold)
  ON CONFLICT (account_user_id) DO UPDATE
    SET low_balance_threshold = EXCLUDED.low_balance_threshold, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_low_balance_threshold(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.set_low_balance_threshold(integer) TO authenticated, service_role;