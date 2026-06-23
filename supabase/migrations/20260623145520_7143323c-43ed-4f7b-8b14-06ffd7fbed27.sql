-- is_tagged is a SECURITY DEFINER helper referenced by RLS policies on
-- note_links, notes_select_tagged, tasks_select_tagged, events_select_tagged.
-- A previous migration revoked EXECUTE from authenticated, which broke those
-- policies (Postgres still checks EXECUTE on the calling role even for
-- SECURITY DEFINER functions invoked from a USING clause). Restore it.
GRANT EXECUTE ON FUNCTION public.is_tagged(text, uuid) TO authenticated;