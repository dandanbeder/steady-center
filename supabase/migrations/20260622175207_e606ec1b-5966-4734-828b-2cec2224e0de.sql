-- Allow members to read their own AI charge rows from the team kitty.
-- Existing policy only allowed reads where account_user_id = auth.uid(),
-- which never matched for team members (their charges are billed to the
-- owner's account_user_id). This adds an acting_user_id self-read.
DROP POLICY IF EXISTS "Owner reads own credit ledger" ON public.credit_ledger;

CREATE POLICY "Read own kitty charges or own account ledger"
  ON public.credit_ledger
  FOR SELECT
  TO authenticated
  USING (
    account_user_id = auth.uid()    -- the kitty owner sees the whole pool
    OR acting_user_id = auth.uid()  -- a member sees only their own charges
    OR public.is_platform_admin()
  );
