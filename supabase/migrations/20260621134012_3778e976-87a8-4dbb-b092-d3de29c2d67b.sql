CREATE OR REPLACE FUNCTION public.revoke_purchased_credits_by_tx(
  _paddle_tx_prefix text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected_user uuid;
  total_revoked integer := 0;
  new_pur integer;
  new_allow integer;
BEGIN
  IF _paddle_tx_prefix IS NULL OR length(_paddle_tx_prefix) = 0 THEN
    RETURN 0;
  END IF;

  -- Find the buyer and total still-remaining credits from this transaction's lots.
  SELECT account_user_id, COALESCE(SUM(credits_remaining), 0)
    INTO affected_user, total_revoked
  FROM public.credit_lots
  WHERE paddle_transaction_id LIKE _paddle_tx_prefix || '%'
  GROUP BY account_user_id
  LIMIT 1;

  IF affected_user IS NULL OR total_revoked <= 0 THEN
    RETURN 0;
  END IF;

  -- Zero the lots (don't delete — keep the audit trail).
  UPDATE public.credit_lots
    SET credits_remaining = 0, updated_at = now()
  WHERE paddle_transaction_id LIKE _paddle_tx_prefix || '%'
    AND credits_remaining > 0;

  -- Decrement the cached purchased balance (never below 0).
  UPDATE public.account_credits
    SET purchased_credits = GREATEST(0, purchased_credits - total_revoked),
        updated_at = now()
  WHERE account_user_id = affected_user
  RETURNING credit_balance, purchased_credits INTO new_allow, new_pur;

  INSERT INTO public.credit_ledger
    (account_user_id, acting_user_id, delta, source,
     balance_after_allowance, balance_after_purchased, note)
  VALUES
    (affected_user, affected_user, -total_revoked, 'refund',
     COALESCE(new_allow,0), COALESCE(new_pur,0),
     'paddle_tx=' || _paddle_tx_prefix);

  RETURN total_revoked;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_purchased_credits_by_tx(text) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_purchased_credits_by_tx(text) TO service_role;

-- Widen credit_ledger.source check to allow 'refund' if a constraint exists.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.credit_ledger'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.credit_ledger DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_source_check
  CHECK (source IN ('allowance','purchased','topup','refund','expire','admin','reset'));
