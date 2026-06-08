
-- =========================================================
-- Microsoft / Outlook Calendar integration
-- =========================================================

-- 1) OAuth tokens (server-only)
CREATE TABLE IF NOT EXISTS public.ms_oauth_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  account_email text,
  scope text,
  tenant_id text,
  needs_reconnect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ms_oauth_tokens TO service_role;
ALTER TABLE public.ms_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies for authenticated/anon. Service role only.

CREATE TRIGGER ms_oauth_tokens_touch_updated_at
BEFORE UPDATE ON public.ms_oauth_tokens
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Graph change-notification subscriptions
CREATE TABLE IF NOT EXISTS public.ms_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  subscription_id text NOT NULL UNIQUE,
  client_state text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ms_subscriptions_calendar ON public.ms_subscriptions(calendar_id);
CREATE INDEX IF NOT EXISTS idx_ms_subscriptions_expires ON public.ms_subscriptions(expires_at);

GRANT ALL ON public.ms_subscriptions TO service_role;
ALTER TABLE public.ms_subscriptions ENABLE ROW LEVEL SECURITY;
-- Service role only.

CREATE TRIGGER ms_subscriptions_touch_updated_at
BEFORE UPDATE ON public.ms_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Cron schedules
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  PERFORM cron.unschedule('sync-microsoft-calendars');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('renew-microsoft-subscriptions');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-microsoft-calendars',
  '17 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://project--sfxrqznrfaeajhzmofan.lovable.app/api/public/hooks/sync-microsoft-calendars',
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_KXQ9E3w3zS3UkRiyUTv_bw_Rzsf79z_'),
    body := '{}'::jsonb
  );
  $cmd$
);

SELECT cron.schedule(
  'renew-microsoft-subscriptions',
  '0 */12 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://project--sfxrqznrfaeajhzmofan.lovable.app/api/public/hooks/renew-microsoft-subscriptions',
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_KXQ9E3w3zS3UkRiyUTv_bw_Rzsf79z_'),
    body := '{}'::jsonb
  );
  $cmd$
);
