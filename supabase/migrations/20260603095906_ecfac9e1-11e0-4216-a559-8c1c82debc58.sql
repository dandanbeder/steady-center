
REVOKE EXECUTE ON FUNCTION public.get_or_create_unsubscribe_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_unsubscribe_token(uuid) TO service_role;
