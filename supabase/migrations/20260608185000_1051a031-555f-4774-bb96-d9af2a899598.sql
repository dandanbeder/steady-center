-- #2 Profile self-update tightening — block privilege/billing escalation via direct PostgREST UPDATE.
-- Strategy: a BEFORE UPDATE trigger that rejects changes to protected columns unless the caller
-- is a trusted role (service_role/postgres/supabase_admin) or a platform admin.

CREATE OR REPLACE FUNCTION public.profiles_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_trusted boolean := current_user IN ('service_role', 'postgres', 'supabase_admin');
  is_admin boolean := false;
BEGIN
  IF is_trusted THEN
    RETURN NEW;
  END IF;

  -- Platform admins may change other users' profiles via the existing admin policy.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND platform_role = 'superadmin'
  ) INTO is_admin;

  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Non-trusted, non-admin path: reject any change to protected columns.
  IF NEW.platform_role           IS DISTINCT FROM OLD.platform_role
  OR NEW.status                  IS DISTINCT FROM OLD.status
  OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
  OR NEW.suspended_reason        IS DISTINCT FROM OLD.suspended_reason
  OR NEW.suspended_message       IS DISTINCT FROM OLD.suspended_message
  OR NEW.deletion_scheduled_at   IS DISTINCT FROM OLD.deletion_scheduled_at
  OR NEW.deletion_requested_by   IS DISTINCT FROM OLD.deletion_requested_by
  OR NEW.must_change_password    IS DISTINCT FROM OLD.must_change_password
  OR NEW.terms_accepted_at       IS DISTINCT FROM OLD.terms_accepted_at
  THEN
    RAISE EXCEPTION 'Protected profile fields can only be changed by trusted server operations';
  END IF;

  RETURN NEW;
END;
$$;

-- Replace the narrower platform_role trigger with the consolidated guard.
DROP TRIGGER IF EXISTS prevent_platform_role_change ON public.profiles;
DROP TRIGGER IF EXISTS profiles_guard_self_update ON public.profiles;

CREATE TRIGGER profiles_guard_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_guard_self_update();
