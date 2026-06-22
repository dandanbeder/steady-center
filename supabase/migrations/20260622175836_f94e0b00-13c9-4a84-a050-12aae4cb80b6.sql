CREATE OR REPLACE FUNCTION public.charge_ai_credits(
  _acting_user uuid, _credits integer, _event_id uuid
)
RETURNS TABLE (
  billing_account uuid,
  allowance_after integer,
  purchased_after integer,
  hard_stopped boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  billing uuid;
  ac record;
  pac record;
  remaining integer;
  from_allowance integer := 0;
  from_purchased integer := 0;
  from_private integer := 0;
  lot record;
  take integer;
  thr integer;
  pooled boolean;
  available integer;
BEGIN
  IF _credits IS NULL OR _credits <= 0 THEN
    _credits := 1;
  END IF;

  billing := public.resolve_billing_account(_acting_user);
  pooled := (billing IS DISTINCT FROM _acting_user);

  INSERT INTO public.account_credits (account_user_id, allowance_credits, credit_balance)
  VALUES (billing, 0, 0)
  ON CONFLICT (account_user_id) DO NOTHING;

  SELECT * INTO ac FROM public.account_credits
    WHERE account_user_id = billing FOR UPDATE;

  IF pooled THEN
    INSERT INTO public.account_credits (account_user_id, allowance_credits, credit_balance)
    VALUES (_acting_user, 0, 0)
    ON CONFLICT (account_user_id) DO NOTHING;
    SELECT * INTO pac FROM public.account_credits
      WHERE account_user_id = _acting_user FOR UPDATE;
  END IF;

  available := COALESCE(ac.credit_balance, 0) + COALESCE(ac.purchased_credits, 0);
  IF pooled THEN
    available := available + COALESCE(pac.purchased_credits, 0);
  END IF;

  IF available < _credits THEN
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

  IF ac.credit_balance > 0 AND remaining > 0 THEN
    from_allowance := LEAST(ac.credit_balance, remaining);
    UPDATE public.account_credits
      SET credit_balance = credit_balance - from_allowance, updated_at = now()
      WHERE account_user_id = billing;
    remaining := remaining - from_allowance;
  END IF;

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

  IF pooled AND remaining > 0 THEN
    UPDATE public.account_credits
      SET topup_paused = true, updated_at = now()
      WHERE account_user_id = billing
        AND credit_balance = 0
        AND purchased_credits = 0;
  END IF;

  IF pooled AND remaining > 0 THEN
    FOR lot IN
      SELECT id, credits_remaining FROM public.credit_lots
      WHERE account_user_id = _acting_user
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
      from_private := from_private + take;
      remaining := remaining - take;
    END LOOP;
    IF from_private > 0 THEN
      UPDATE public.account_credits
        SET purchased_credits = GREATEST(purchased_credits - from_private, 0),
            updated_at = now()
        WHERE account_user_id = _acting_user;
      SELECT * INTO pac FROM public.account_credits
        WHERE account_user_id = _acting_user;
    END IF;
  END IF;

  SELECT * INTO ac FROM public.account_credits WHERE account_user_id = billing;

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
  IF from_private > 0 THEN
    INSERT INTO public.credit_ledger
      (account_user_id, acting_user_id, delta, source, ai_usage_event_id,
       balance_after_allowance, balance_after_purchased, note)
    VALUES
      (_acting_user, _acting_user, -from_private, 'purchased', _event_id,
       COALESCE(pac.credit_balance, 0), COALESCE(pac.purchased_credits, 0),
       'private fallback after team kitty empty');
  END IF;

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