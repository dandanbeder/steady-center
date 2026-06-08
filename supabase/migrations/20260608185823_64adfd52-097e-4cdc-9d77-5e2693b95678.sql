-- #1 feature_flags read scoping.
-- Schema has no per-flag audience column, so the leak is: every authenticated
-- user could read flag descriptions/internal metadata/disabled-flag presence.
-- Fix: regular users see only enabled flags via row policy, and only the
-- columns needed to evaluate behaviour client-side (key, enabled) via column
-- grants. Admins keep full access through is_platform_admin().

DROP POLICY IF EXISTS feature_flags_select_all ON public.feature_flags;

CREATE POLICY feature_flags_select_enabled
ON public.feature_flags
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR enabled = true
);

-- Restrict columns visible to ordinary users; admins read all via the
-- service_role / superadmin paths in admin server fns.
REVOKE SELECT ON public.feature_flags FROM authenticated;
GRANT SELECT (id, key, enabled) ON public.feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;
