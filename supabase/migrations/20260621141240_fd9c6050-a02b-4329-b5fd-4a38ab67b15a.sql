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
        credit_balance = EXCLUDED.allowance_credits,
        current_cycle_start = EXCLUDED.current_cycle_start,
        current_cycle_end = EXCLUDED.current_cycle_end,
        low_balance_alerted_at = NULL,
        hard_stop_alerted_at = NULL,
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

-- Atomic "claim" for the hard-stop alert. Returns true exactly once per
-- (cycle, account); subsequent calls return false until the next reset.
CREATE OR REPLACE FUNCTION public.try_claim_hard_stop_alert(_account uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  did boolean := false;
BEGIN
  UPDATE public.account_credits
     SET hard_stop_alerted_at = now(), updated_at = now()
   WHERE account_user_id = _account
     AND hard_stop_alerted_at IS NULL
  RETURNING true INTO did;
  RETURN COALESCE(did, false);
END;
$$;
REVOKE ALL ON FUNCTION public.try_claim_hard_stop_alert(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.try_claim_hard_stop_alert(uuid) TO service_role;