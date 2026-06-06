
REVOKE EXECUTE ON FUNCTION public.cascade_soft_delete_folder() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cascade_soft_delete_list()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_trash()                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_trash()                TO service_role;
-- list_trash & empty_my_trash are signed-in user facing (SECURITY INVOKER): keep authenticated execute only
REVOKE EXECUTE ON FUNCTION public.list_trash()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.empty_my_trash()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_trash()      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.empty_my_trash()  TO authenticated;
