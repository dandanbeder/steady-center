CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  opt_in boolean := COALESCE((m->>'marketing_opt_in')::boolean, false);
  terms_ts timestamptz := NULLIF(m->>'terms_accepted_at', '')::timestamptz;
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    organisation,
    role_title,
    phone,
    hear_about_us,
    timezone,
    terms_accepted_at,
    marketing_opt_in,
    marketing_opt_in_at
  )
  VALUES (
    NEW.id,
    COALESCE(m->>'full_name', ''),
    NULLIF(m->>'organisation', ''),
    NULLIF(m->>'role_title', ''),
    NULLIF(m->>'phone', ''),
    NULLIF(m->>'hear_about_us', ''),
    COALESCE(NULLIF(m->>'timezone', ''), 'Africa/Johannesburg'),
    terms_ts,
    opt_in,
    CASE WHEN opt_in THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;