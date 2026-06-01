
-- ============================================================================
-- Refine sharing: invitations + access_requests
-- ============================================================================

-- 1) invitations table
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invited_email text NOT NULL,
  proposed_role public.membership_role NOT NULL,
  invited_by uuid NOT NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  CONSTRAINT invitations_proposed_role_not_owner CHECK (proposed_role <> 'owner')
);
CREATE INDEX idx_invitations_business_status ON public.invitations(business_id, status);
CREATE INDEX idx_invitations_email_status ON public.invitations(lower(invited_email), status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated USING (
    invited_by = auth.uid()
    OR public.is_member(business_id, 'admin')
    OR public.is_platform_admin()
    OR lower(invited_email) = lower(COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), ''))
  );

CREATE POLICY invitations_insert_admin ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member(business_id, 'admin') OR public.is_platform_admin());

CREATE POLICY invitations_update_admin ON public.invitations
  FOR UPDATE TO authenticated
  USING (public.is_member(business_id, 'admin') OR public.is_platform_admin())
  WITH CHECK (public.is_member(business_id, 'admin') OR public.is_platform_admin());

CREATE POLICY invitations_delete_admin ON public.invitations
  FOR DELETE TO authenticated
  USING (public.is_member(business_id, 'admin') OR public.is_platform_admin());


-- 2) access_requests table
CREATE TABLE public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  requester_user_id uuid NOT NULL,
  invitation_id uuid REFERENCES public.invitations(id) ON DELETE SET NULL,
  proposed_role public.membership_role NOT NULL DEFAULT 'viewer',
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  CONSTRAINT access_requests_proposed_role_not_owner CHECK (proposed_role <> 'owner')
);
CREATE UNIQUE INDEX idx_access_requests_one_pending
  ON public.access_requests(business_id, requester_user_id)
  WHERE status = 'pending';
CREATE INDEX idx_access_requests_business_status ON public.access_requests(business_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_requests TO authenticated;
GRANT ALL ON public.access_requests TO service_role;

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_requests_select ON public.access_requests
  FOR SELECT TO authenticated USING (
    requester_user_id = auth.uid()
    OR public.is_member(business_id, 'admin')
    OR public.is_platform_admin()
  );

CREATE POLICY access_requests_insert_self ON public.access_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.business_id = access_requests.business_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

CREATE POLICY access_requests_update_admin ON public.access_requests
  FOR UPDATE TO authenticated
  USING (public.is_member(business_id, 'admin') OR public.is_platform_admin())
  WITH CHECK (public.is_member(business_id, 'admin') OR public.is_platform_admin());

CREATE POLICY access_requests_delete ON public.access_requests
  FOR DELETE TO authenticated
  USING (
    requester_user_id = auth.uid()
    OR public.is_member(business_id, 'admin')
    OR public.is_platform_admin()
  );


-- 3) Backfill: migrate existing 'invited' memberships → invitations, then drop them.
INSERT INTO public.invitations (business_id, invited_email, proposed_role, invited_by, token, status, created_at, expires_at)
SELECT
  m.business_id,
  m.invited_email,
  CASE WHEN m.role = 'owner' THEN 'admin'::public.membership_role ELSE m.role END,
  COALESCE(m.invited_by, (SELECT owner_id FROM public.businesses b WHERE b.id = m.business_id)),
  COALESCE(m.invite_token, gen_random_uuid()),
  'sent',
  m.created_at,
  COALESCE(m.invite_token_expires_at, now() + interval '14 days')
FROM public.memberships m
WHERE m.status = 'invited' AND m.invited_email IS NOT NULL;

DELETE FROM public.memberships WHERE status = 'invited';

-- Drop legacy claim_pending_invites trigger on auth.users (no longer the flow)
DROP TRIGGER IF EXISTS on_auth_user_created_claim_invites ON auth.users;
DROP FUNCTION IF EXISTS public.claim_pending_invites() CASCADE;

-- Drop legacy accept_invite_by_token (superseded by request-access flow)
DROP FUNCTION IF EXISTS public.accept_invite_by_token(uuid) CASCADE;

-- Drop legacy columns from memberships (memberships are now always active)
ALTER TABLE public.memberships
  DROP COLUMN IF EXISTS invite_token,
  DROP COLUMN IF EXISTS invite_token_expires_at,
  DROP COLUMN IF EXISTS invited_email;
