GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member(uuid, text) TO service_role;