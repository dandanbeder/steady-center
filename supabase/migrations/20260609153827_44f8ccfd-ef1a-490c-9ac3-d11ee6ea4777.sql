DO $$
BEGIN
  PERFORM cron.unschedule('sync-microsoft-calendars');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('renew-microsoft-subscriptions');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-microsoft-calendars',
  '0 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://project--sfxrqznrfaeajhzmofan.lovable.app/api/public/hooks/sync-microsoft-calendars',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
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
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cmd$
);