-- Fix: the read-only support-session guard was blocking the TARGET user
-- from making changes to their own data while an admin had an active
-- read-only session open. The guard should only block the supporting admin,
-- never the user themselves. The user is always allowed to act on their own
-- data, regardless of any open support session.
CREATE OR REPLACE FUNCTION public.enforce_readonly_support_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected_user uuid;
  actor uuid;
BEGIN
  affected_user := COALESCE(
    NULLIF(to_jsonb(NEW)->>'owner_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'owner_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'user_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'user_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'author_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'author_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'created_by', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'created_by', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'id', '')::uuid
  );

  actor := auth.uid();

  -- The user is always allowed to change their own data, even if an admin
  -- has an active read-only support session looking at it. Only block when
  -- some OTHER actor (an admin) is trying to write to a user under a
  -- read-only session.
  IF affected_user IS NOT NULL
     AND actor IS DISTINCT FROM affected_user
     AND public.is_user_under_active_readonly_support_session(affected_user)
  THEN
    RAISE EXCEPTION 'Read-only support session blocks this change';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;