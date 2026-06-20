
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_protected_primary boolean NOT NULL DEFAULT false;

-- Promote and protect Daniel
UPDATE public.profiles
   SET platform_role = 'superadmin',
       is_protected_primary = true,
       status = 'active',
       suspended_reason = NULL,
       suspended_message = NULL,
       deletion_scheduled_at = NULL,
       deletion_requested_by = NULL
 WHERE id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37';

-- Ensure only one protected primary exists
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_protected_primary
  ON public.profiles ((1)) WHERE is_protected_primary = true;

-- Guard trigger: protect the primary super admin from any destructive change
CREATE OR REPLACE FUNCTION public.protect_primary_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No one can flip the protected flag off
  IF OLD.is_protected_primary = true AND NEW.is_protected_primary = false THEN
    RAISE EXCEPTION 'The primary super admin cannot be unprotected';
  END IF;

  IF OLD.is_protected_primary = true THEN
    IF NEW.platform_role IS DISTINCT FROM OLD.platform_role THEN
      RAISE EXCEPTION 'The primary super admin role cannot be changed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'active' THEN
      RAISE EXCEPTION 'The primary super admin cannot be suspended';
    END IF;
    IF NEW.deletion_scheduled_at IS NOT NULL THEN
      RAISE EXCEPTION 'The primary super admin cannot be scheduled for deletion';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_primary_superadmin ON public.profiles;
CREATE TRIGGER trg_protect_primary_superadmin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_superadmin();
