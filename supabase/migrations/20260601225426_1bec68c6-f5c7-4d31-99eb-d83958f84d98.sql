
-- Fix 1: Revoke EXECUTE from anon/public on SECURITY DEFINER functions in public schema.
-- These are helpers used by triggers and RLS policies; they do not need to be callable
-- directly by API clients.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_event_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_task_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.businesses_seed_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_item_tags_for_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_track_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_for_list(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_membership_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_readonly_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_member(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tagged(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_business_members(uuid) FROM PUBLIC, anon;

-- Fix 2: account-logos is a public bucket — files are served via the public CDN
-- without needing a SELECT policy on storage.objects. The broad SELECT policy
-- allowed anyone to LIST every file in the bucket. Drop it; public reads of
-- individual logo URLs continue to work because the bucket itself is public.
DROP POLICY IF EXISTS "Account logos public read" ON storage.objects;
