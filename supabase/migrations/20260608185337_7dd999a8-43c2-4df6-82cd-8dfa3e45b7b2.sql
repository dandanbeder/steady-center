ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

-- Extend the self-update guard to also protect the new column.
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

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND platform_role = 'superadmin'
  ) INTO is_admin;

  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.platform_role           IS DISTINCT FROM OLD.platform_role
  OR NEW.status                  IS DISTINCT FROM OLD.status
  OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
  OR NEW.suspended_reason        IS DISTINCT FROM OLD.suspended_reason
  OR NEW.suspended_message       IS DISTINCT FROM OLD.suspended_message
  OR NEW.deletion_scheduled_at   IS DISTINCT FROM OLD.deletion_scheduled_at
  OR NEW.deletion_requested_by   IS DISTINCT FROM OLD.deletion_requested_by
  OR NEW.must_change_password    IS DISTINCT FROM OLD.must_change_password
  OR NEW.terms_accepted_at       IS DISTINCT FROM OLD.terms_accepted_at
  OR NEW.welcome_email_sent_at   IS DISTINCT FROM OLD.welcome_email_sent_at
  THEN
    RAISE EXCEPTION 'Protected profile fields can only be changed by trusted server operations';
  END IF;

  RETURN NEW;
END;
$$;
