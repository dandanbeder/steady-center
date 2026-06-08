
REVOKE EXECUTE ON FUNCTION public.user_in_audience(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_in_audience(uuid, jsonb) TO authenticated, service_role;
