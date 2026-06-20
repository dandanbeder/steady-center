
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_pulse_cadence text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS platform_pulse_last_sent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_platform_pulse_cadence_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_platform_pulse_cadence_chk
      CHECK (platform_pulse_cadence IN ('off','daily','weekly'));
  END IF;
END $$;

UPDATE public.profiles
   SET platform_pulse_cadence = 'daily'
 WHERE id = (SELECT id FROM auth.users WHERE lower(email) = 'daniel@flightmed.software')
   AND platform_pulse_cadence = 'off';

-- Allow trusted server ops (service_role) to update the new columns by
-- extending the guard: it already permits trusted callers and superadmins,
-- and end-users cannot update profiles.* outside the allowed list, so adding
-- the columns to the protected set keeps end-users from touching them while
-- superadmins / service role can.
