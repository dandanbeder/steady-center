CREATE OR REPLACE FUNCTION public.is_user_under_active_support_session(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_access_log
    WHERE target_user_id = _user_id
      AND ended_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_user_under_active_readonly_support_session(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_access_log
    WHERE target_user_id = _user_id
      AND ended_at IS NULL
      AND mode = 'read'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_user_under_active_support_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_user_under_active_readonly_support_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_user_under_active_support_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_user_under_active_readonly_support_session(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_readonly_support_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_user uuid;
BEGIN
  affected_user := COALESCE(
    NULLIF(to_jsonb(NEW)->>'owner_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'owner_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'user_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'user_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'author_id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'author_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'created_by', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'created_by', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'id', '')::uuid
  );

  IF affected_user IS NOT NULL
     AND public.is_user_under_active_readonly_support_session(affected_user)
  THEN
    RAISE EXCEPTION 'Read-only support session blocks this change';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'profiles',
    'businesses',
    'calendars',
    'events',
    'tasks',
    'notes',
    'note_attachments',
    'note_links',
    'folders',
    'lists',
    'meetings',
    'daily_pulses',
    'weekly_goals',
    'weekly_reports',
    'inbox_items',
    'outcomes',
    'comments',
    'comment_mentions',
    'shares',
    'reminders',
    'time_entries',
    'assistant_actions',
    'ai_prefs',
    'notification_prefs',
    'templates',
    'item_tags'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS enforce_readonly_support_session_%1$I ON public.%1$I', tbl);
      EXECUTE format(
        'CREATE TRIGGER enforce_readonly_support_session_%1$I BEFORE INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.enforce_readonly_support_session()',
        tbl
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS notes_hide_journal_during_support_session ON public.notes;
CREATE POLICY notes_hide_journal_during_support_session
ON public.notes
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  COALESCE(note_type, 'note') <> 'journal'
  OR NOT public.is_user_under_active_support_session(auth.uid())
);