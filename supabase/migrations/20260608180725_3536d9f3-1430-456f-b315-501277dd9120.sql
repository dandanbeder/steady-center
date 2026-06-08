
REVOKE EXECUTE ON FUNCTION public.resolve_comment_parent(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comments_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comments_before_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comments_process_mentions() FROM PUBLIC, anon, authenticated;
