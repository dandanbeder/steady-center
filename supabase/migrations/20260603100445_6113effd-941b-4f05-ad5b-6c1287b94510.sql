-- Add subscription status to profiles for billing tracking
DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('trial','active','canceled','past_due','none');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status public.subscription_status NOT NULL DEFAULT 'trial';

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON public.profiles(subscription_status);
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_opt_in ON public.profiles(marketing_opt_in) WHERE marketing_opt_in = true;

-- Allow superadmins to read all profiles (for subscriber management).
-- Existing policies already restrict regular users to their own profile.
DROP POLICY IF EXISTS "Superadmins can view all profiles" ON public.profiles;
CREATE POLICY "Superadmins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Superadmins can update any profile" ON public.profiles;
CREATE POLICY "Superadmins can update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());