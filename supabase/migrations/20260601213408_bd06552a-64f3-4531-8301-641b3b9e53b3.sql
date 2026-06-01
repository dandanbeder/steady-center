-- Trigger-only functions: should never be callable directly.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_set_completed_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_track_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_event_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_task_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.businesses_seed_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pending_invites() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- RLS-helper functions: revoke from anon; keep authenticated (used in RLS policies).
REVOKE EXECUTE ON FUNCTION public.is_member(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_membership_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.business_for_list(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_readonly_session() FROM PUBLIC, anon;

-- User-facing RPCs: keep authenticated, drop anon (these have their own auth checks inside).
REVOKE EXECUTE ON FUNCTION public.accept_invite_by_token(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_business_members(uuid) FROM PUBLIC, anon;