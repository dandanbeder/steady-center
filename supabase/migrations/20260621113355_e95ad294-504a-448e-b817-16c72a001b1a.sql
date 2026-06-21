
-- ============================================================================
-- Journal consent-based admin access
-- ============================================================================

-- 1. Tables -----------------------------------------------------------------

CREATE TABLE public.journal_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  mode text NOT NULL DEFAULT 'read' CHECK (mode IN ('read','write')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_grants_target_active_idx
  ON public.journal_access_grants (target_user_id, status)
  WHERE status IN ('pending','accepted');
CREATE INDEX journal_grants_admin_active_idx
  ON public.journal_access_grants (admin_id, status)
  WHERE status IN ('pending','accepted');

GRANT SELECT, INSERT, UPDATE ON public.journal_access_grants TO authenticated;
GRANT ALL ON public.journal_access_grants TO service_role;
ALTER TABLE public.journal_access_grants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.journal_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.journal_access_grants(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id uuid,
  action text NOT NULL DEFAULT 'view' CHECK (action IN ('view','edit','list')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_access_log_target_idx
  ON public.journal_access_log (target_user_id, accessed_at DESC);
CREATE INDEX journal_access_log_admin_idx
  ON public.journal_access_log (admin_id, accessed_at DESC);

GRANT SELECT, INSERT ON public.journal_access_log TO authenticated;
GRANT ALL ON public.journal_access_log TO service_role;
ALTER TABLE public.journal_access_log ENABLE ROW LEVEL SECURITY;

-- 2. updated_at trigger ------------------------------------------------------

CREATE TRIGGER journal_grants_touch_updated_at
  BEFORE UPDATE ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Append-only log --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.journal_access_log_block_modify()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'journal_access_log is append-only';
END $$;

CREATE TRIGGER journal_access_log_no_update
  BEFORE UPDATE OR DELETE ON public.journal_access_log
  FOR EACH ROW EXECUTE FUNCTION public.journal_access_log_block_modify();

-- 4. RLS policies on grants -------------------------------------------------

-- Target user sees grants involving them; admin sees their own requests.
CREATE POLICY jag_select_self
  ON public.journal_access_grants FOR SELECT TO authenticated
  USING (target_user_id = auth.uid() OR admin_id = auth.uid());

-- Only super admins may insert a request, and only as themselves.
CREATE POLICY jag_insert_admin
  ON public.journal_access_grants FOR INSERT TO authenticated
  WITH CHECK (
    admin_id = auth.uid()
    AND public.is_platform_admin()
    AND status = 'pending'
    AND target_user_id <> auth.uid()
  );

-- Target user can respond (accept/decline) or revoke. Admin may cancel their own pending request.
CREATE POLICY jag_update_self
  ON public.journal_access_grants FOR UPDATE TO authenticated
  USING (target_user_id = auth.uid() OR admin_id = auth.uid())
  WITH CHECK (target_user_id = auth.uid() OR admin_id = auth.uid());

-- 5. Guard: prevent illegal state transitions ------------------------------

CREATE OR REPLACE FUNCTION public.journal_grants_guard_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Identity columns are immutable post-insert
  IF NEW.admin_id <> OLD.admin_id
     OR NEW.target_user_id <> OLD.target_user_id
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'Cannot change immutable fields on a journal access grant';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Only the target can accept or decline a pending request
    IF NEW.status IN ('accepted','declined') THEN
      IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending grants can be accepted or declined';
      END IF;
      IF auth.uid() <> OLD.target_user_id THEN
        RAISE EXCEPTION 'Only the target user can respond to a journal access request';
      END IF;
      NEW.responded_at := now();
      IF NEW.status = 'accepted' AND NEW.expires_at IS NULL THEN
        NEW.expires_at := now() + interval '24 hours';
      END IF;
    ELSIF NEW.status = 'revoked' THEN
      -- Target may revoke at any time; admin may cancel their own still-pending request
      IF NOT (auth.uid() = OLD.target_user_id
              OR (auth.uid() = OLD.admin_id AND OLD.status = 'pending')) THEN
        RAISE EXCEPTION 'Not allowed to revoke this grant';
      END IF;
      NEW.revoked_at := now();
      NEW.revoked_by := auth.uid();
    ELSIF NEW.status = 'expired' THEN
      -- Only service role / scheduled jobs may mark expired
      IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
        RAISE EXCEPTION 'Only the system can expire a grant';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition to %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_grants_guard
  BEFORE UPDATE ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.journal_grants_guard_transitions();

-- 6. RLS on log -------------------------------------------------------------

-- The owner of the journal can always read their own log; the admin sees rows for grants they hold.
CREATE POLICY jal_select_self
  ON public.journal_access_log FOR SELECT TO authenticated
  USING (target_user_id = auth.uid() OR admin_id = auth.uid());

-- Inserts: only the admin can write their own access entries, and only with an active grant.
CREATE POLICY jal_insert_admin
  ON public.journal_access_log FOR INSERT TO authenticated
  WITH CHECK (
    admin_id = auth.uid()
    AND public.is_platform_admin()
    AND EXISTS (
      SELECT 1 FROM public.journal_access_grants g
      WHERE g.id = grant_id
        AND g.admin_id = auth.uid()
        AND g.target_user_id = journal_access_log.target_user_id
        AND g.status = 'accepted'
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (action <> 'edit' OR g.mode = 'write')
    )
  );

-- 7. Helper: has_active_journal_grant --------------------------------------

CREATE OR REPLACE FUNCTION public.has_active_journal_grant(
  _admin_id uuid, _target_user_id uuid, _mode text DEFAULT 'read'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journal_access_grants
    WHERE admin_id = _admin_id
      AND target_user_id = _target_user_id
      AND status = 'accepted'
      AND (expires_at IS NULL OR expires_at > now())
      AND (_mode = 'read' OR mode = 'write')
  );
$$;

-- 8. Rewrite Journal RLS to permit consented admin access -------------------

DROP POLICY IF EXISTS notes_journal_owner_only_select ON public.notes;
DROP POLICY IF EXISTS notes_journal_owner_only_update ON public.notes;

CREATE POLICY notes_journal_owner_only_select
  ON public.notes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    COALESCE(note_type,'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      public.is_platform_admin()
      AND public.has_active_journal_grant(auth.uid(), owner_id, 'read')
      AND NOT public.is_user_under_active_support_session(auth.uid())
    )
  );

CREATE POLICY notes_journal_owner_only_update
  ON public.notes AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    COALESCE(note_type,'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      public.is_platform_admin()
      AND public.has_active_journal_grant(auth.uid(), owner_id, 'write')
      AND NOT public.is_user_under_active_support_session(auth.uid())
    )
  )
  WITH CHECK (
    COALESCE(note_type,'note') <> 'journal'
    OR owner_id = auth.uid()
    OR (
      public.is_platform_admin()
      AND public.has_active_journal_grant(auth.uid(), owner_id, 'write')
      AND NOT public.is_user_under_active_support_session(auth.uid())
    )
  );

-- Insert/delete stay owner-only via the existing notes_journal_owner_only_delete and
-- notes_journal_insert_personal policies.

-- 9. Notifications and audit-log triggers ----------------------------------

CREATE OR REPLACE FUNCTION public.journal_grants_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'A super admin') INTO v_admin_name
    FROM public.profiles WHERE id = NEW.admin_id;

  IF TG_OP = 'INSERT' THEN
    -- Notify the target user of the request
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
    VALUES (
      NEW.target_user_id,
      'journal_access_request',
      v_admin_name || ' is requesting access to your Journal',
      left(NEW.reason, 280),
      'journal_grant', NEW.id, '/settings?tab=privacy'
    );
    INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, reason, metadata)
    VALUES (NEW.admin_id, NEW.target_user_id, 'journal_access_requested', NEW.reason,
            jsonb_build_object('grant_id', NEW.id, 'mode', NEW.mode));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, reason, metadata)
    VALUES (
      NEW.admin_id, NEW.target_user_id,
      'journal_access_' || NEW.status,
      COALESCE(NEW.reason, ''),
      jsonb_build_object('grant_id', NEW.id, 'mode', NEW.mode,
                         'actor', auth.uid(), 'expires_at', NEW.expires_at)
    );

    -- Tell the admin when the user responded
    IF NEW.status IN ('accepted','declined') AND NEW.admin_id <> auth.uid() THEN
      INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
      VALUES (
        NEW.admin_id,
        'journal_access_' || NEW.status,
        'Journal access ' || NEW.status,
        'Your request for ' || NEW.mode || ' access was ' || NEW.status || '.',
        'journal_grant', NEW.id, '/admin/users/' || NEW.target_user_id::text
      );
    END IF;

    -- Tell the target if a grant was revoked/expired by anyone
    IF NEW.status IN ('revoked','expired') AND NEW.target_user_id <> COALESCE(auth.uid(), NEW.target_user_id) THEN
      INSERT INTO public.notifications (user_id, kind, title, ref_type, ref_id, link)
      VALUES (NEW.target_user_id, 'journal_access_' || NEW.status,
              'Journal access ' || NEW.status,
              'journal_grant', NEW.id, '/settings?tab=privacy');
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER journal_grants_after_insert
  AFTER INSERT ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.journal_grants_after_change();

CREATE TRIGGER journal_grants_after_update
  AFTER UPDATE ON public.journal_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.journal_grants_after_change();

-- 10. Notify target on every actual access + audit it ----------------------

CREATE OR REPLACE FUNCTION public.journal_access_log_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'A super admin') INTO v_admin_name
    FROM public.profiles WHERE id = NEW.admin_id;

  INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
  VALUES (
    NEW.target_user_id,
    'journal_access_viewed',
    v_admin_name || ' viewed your Journal',
    CASE NEW.action WHEN 'edit' THEN 'They made an edit under an active write grant.'
                    WHEN 'list' THEN 'They opened the Journal list.'
                    ELSE 'They opened an entry under an active read grant.' END,
    'journal_grant', NEW.grant_id, '/settings?tab=privacy'
  );

  INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, metadata)
  VALUES (NEW.admin_id, NEW.target_user_id, 'journal_access_' || NEW.action,
          jsonb_build_object('grant_id', NEW.grant_id, 'note_id', NEW.note_id));
  RETURN NEW;
END $$;

CREATE TRIGGER journal_access_log_notify
  AFTER INSERT ON public.journal_access_log
  FOR EACH ROW EXECUTE FUNCTION public.journal_access_log_after_insert();

-- 11. Scheduled-expiry helper (call from server fn / cron) -----------------

CREATE OR REPLACE FUNCTION public.expire_journal_access_grants()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.journal_access_grants
     SET status = 'expired'
   WHERE status = 'accepted'
     AND expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
