
-- Reaffirm primary superadmin state (idempotent)
UPDATE public.profiles
   SET platform_role = 'superadmin'::public.platform_role,
       status = 'active',
       suspended_reason = NULL,
       suspended_message = NULL,
       deletion_scheduled_at = NULL,
       deletion_requested_by = NULL
 WHERE id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37';

-- Hard guard: protect the primary superadmin from demotion / suspension / deletion
CREATE OR REPLACE FUNCTION public.protect_primary_superadmin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.id <> 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37'::uuid THEN
    RETURN NEW;
  END IF;

  IF NEW.platform_role IS DISTINCT FROM 'superadmin'::public.platform_role THEN
    RAISE EXCEPTION 'The primary superadmin cannot be demoted';
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'The primary superadmin cannot be suspended or deactivated';
  END IF;
  IF NEW.deletion_scheduled_at IS NOT NULL THEN
    RAISE EXCEPTION 'The primary superadmin cannot be scheduled for deletion';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_primary_superadmin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37'::uuid THEN
    RAISE EXCEPTION 'The primary superadmin cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_primary_superadmin_update() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_primary_superadmin_delete() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS protect_primary_superadmin_update_trg ON public.profiles;
CREATE TRIGGER protect_primary_superadmin_update_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_superadmin_update();

DROP TRIGGER IF EXISTS protect_primary_superadmin_delete_trg ON public.profiles;
CREATE TRIGGER protect_primary_superadmin_delete_trg
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_superadmin_delete();
