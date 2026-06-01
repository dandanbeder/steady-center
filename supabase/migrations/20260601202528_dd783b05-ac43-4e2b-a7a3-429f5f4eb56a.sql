-- 1. Columns for invite tokens
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS invite_token uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS memberships_invited_email_idx
  ON public.memberships (lower(invited_email))
  WHERE invited_email IS NOT NULL AND status = 'invited';

-- 2. On new user signup, claim any pending invites for their email
CREATE OR REPLACE FUNCTION public.claim_pending_invites()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.memberships
     SET user_id = NEW.id,
         status = 'active',
         invite_token = NULL,
         invite_token_expires_at = NULL
   WHERE status = 'invited'
     AND user_id IS NULL
     AND invited_email IS NOT NULL
     AND lower(invited_email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_claim_invites ON auth.users;
CREATE TRIGGER on_auth_user_claim_invites
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.claim_pending_invites();

-- 3. Accept invite by token (for signed-in users clicking an invite link)
CREATE OR REPLACE FUNCTION public.accept_invite_by_token(p_token uuid)
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.memberships;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO m FROM public.memberships
    WHERE invite_token = p_token AND status = 'invited'
    LIMIT 1;

  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already used';
  END IF;

  IF m.invite_token_expires_at IS NOT NULL AND m.invite_token_expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  UPDATE public.memberships
     SET user_id = uid,
         status = 'active',
         invite_token = NULL,
         invite_token_expires_at = NULL
   WHERE id = m.id
   RETURNING * INTO m;

  RETURN m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invite_by_token(uuid) TO authenticated;

-- 4. List members for a business with profile info (admin+ only)
CREATE OR REPLACE FUNCTION public.list_business_members(p_business uuid)
RETURNS TABLE (
  id uuid,
  business_id uuid,
  user_id uuid,
  invited_email text,
  role text,
  status text,
  created_at timestamptz,
  full_name text,
  email text,
  has_pending_invite boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_member(p_business, 'admin') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.business_id,
    m.user_id,
    m.invited_email,
    m.role::text,
    m.status::text,
    m.created_at,
    p.full_name,
    COALESCE(u.email, m.invited_email) AS email,
    (m.invite_token IS NOT NULL) AS has_pending_invite
  FROM public.memberships m
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.business_id = p_business
  ORDER BY m.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_business_members(uuid) TO authenticated;