
REVOKE EXECUTE ON FUNCTION public.business_for_list(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.current_membership_role(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_active_readonly_session() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_member(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_tagged(text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.list_business_members(uuid) FROM authenticated;
