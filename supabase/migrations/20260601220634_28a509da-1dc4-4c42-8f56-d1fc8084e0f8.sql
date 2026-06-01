
REVOKE EXECUTE ON FUNCTION public.item_tags_normalize_email() FROM PUBLIC, anon, authenticated;
-- is_tagged is referenced by RLS policies and must remain callable by authenticated
