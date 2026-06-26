
-- 1) Make journal-owner-only protections RESTRICTIVE (AND-ed with permissive policies)
-- so that no other policy (shares, business membership, superadmin shortcut) can ever
-- expose a journal note to anyone but the owner or a super admin with an active, time-boxed grant.

DROP POLICY IF EXISTS notes_journal_owner_only_select ON public.notes;
DROP POLICY IF EXISTS notes_journal_owner_only_update ON public.notes;
DROP POLICY IF EXISTS notes_journal_owner_only_delete ON public.notes;
DROP POLICY IF EXISTS notes_journal_insert_personal ON public.notes;
DROP POLICY IF EXISTS notes_hide_journal_during_support_session ON public.notes;

CREATE POLICY notes_journal_restrict_select ON public.notes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    COALESCE(note_type, 'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      is_platform_admin()
      AND has_active_journal_grant(auth.uid(), owner_id, 'read')
      AND NOT is_user_under_active_support_session(auth.uid())
    )
  );

CREATE POLICY notes_journal_restrict_update ON public.notes
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    COALESCE(note_type, 'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      is_platform_admin()
      AND has_active_journal_grant(auth.uid(), owner_id, 'write')
      AND NOT is_user_under_active_support_session(auth.uid())
    )
  )
  WITH CHECK (
    COALESCE(note_type, 'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      is_platform_admin()
      AND has_active_journal_grant(auth.uid(), owner_id, 'write')
      AND NOT is_user_under_active_support_session(auth.uid())
    )
  );

CREATE POLICY notes_journal_restrict_delete ON public.notes
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    COALESCE(note_type, 'note') <> 'journal'
    OR owner_id = auth.uid()
  );

CREATE POLICY notes_journal_restrict_insert ON public.notes
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(note_type, 'note') <> 'journal'
    OR (owner_id = auth.uid() AND business_id IS NULL AND folder_id IS NULL)
  );

-- 2) Block sharing of journal notes entirely. Even the owner cannot create a share row for a journal note.
CREATE OR REPLACE FUNCTION public.is_journal_note(_note_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.notes WHERE id = _note_id AND COALESCE(note_type,'note') = 'journal')
$$;

DROP POLICY IF EXISTS shares_no_journal_insert ON public.shares;
CREATE POLICY shares_no_journal_insert ON public.shares
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (resource_type <> 'note' OR NOT public.is_journal_note(resource_id));

DROP POLICY IF EXISTS shares_no_journal_update ON public.shares;
CREATE POLICY shares_no_journal_update ON public.shares
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (resource_type <> 'note' OR NOT public.is_journal_note(resource_id))
  WITH CHECK (resource_type <> 'note' OR NOT public.is_journal_note(resource_id));

-- 3) Notify the user when a super admin requests access.
CREATE OR REPLACE FUNCTION public.notify_journal_grant_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'Super admin') INTO v_admin_name FROM public.profiles WHERE id = NEW.admin_id;
  INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
  VALUES (
    NEW.target_user_id,
    'journal_access_request',
    v_admin_name || ' is requesting access to your Journal to assist you',
    'Reason: ' || NEW.reason,
    'journal_access_grant',
    NEW.id,
    '/settings'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_grant_request_notify ON public.journal_access_grants;
CREATE TRIGGER trg_journal_grant_request_notify
  AFTER INSERT ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.notify_journal_grant_request();

-- 4) Notify the admin when the user responds (accept/decline/revoke).
CREATE OR REPLACE FUNCTION public.notify_journal_grant_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id)
    VALUES (
      NEW.admin_id,
      'journal_access_' || NEW.status,
      CASE NEW.status
        WHEN 'accepted' THEN 'Journal access accepted'
        WHEN 'declined' THEN 'Journal access declined'
        WHEN 'revoked'  THEN 'Journal access revoked'
        ELSE 'Journal access updated'
      END,
      NULL,
      'journal_access_grant',
      NEW.id
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_grant_response_notify ON public.journal_access_grants;
CREATE TRIGGER trg_journal_grant_response_notify
  AFTER UPDATE ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.notify_journal_grant_response();

-- 5) Notify the user every time their journal is actually opened/edited.
CREATE OR REPLACE FUNCTION public.notify_journal_access_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'Super admin') INTO v_admin_name FROM public.profiles WHERE id = NEW.admin_id;
  INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
  VALUES (
    NEW.target_user_id,
    'journal_accessed',
    v_admin_name ||
      CASE NEW.action
        WHEN 'edit' THEN ' edited a Journal entry'
        WHEN 'list' THEN ' opened your Journal'
        ELSE ' viewed a Journal entry'
      END,
    NULL,
    'journal_access_log',
    NEW.id,
    '/settings'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_access_log_notify ON public.journal_access_log;
CREATE TRIGGER trg_journal_access_log_notify
  AFTER INSERT ON public.journal_access_log
  FOR EACH ROW EXECUTE FUNCTION public.notify_journal_access_log();
