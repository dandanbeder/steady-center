
CREATE OR REPLACE FUNCTION public.journal_grants_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'A super admin') INTO v_admin_name
    FROM public.profiles WHERE id = NEW.admin_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
    VALUES (NEW.target_user_id, 'journal_access_request',
            v_admin_name || ' is requesting access to your Journal',
            left(NEW.reason, 280),
            'journal_grant', NEW.id, '/settings?tab=privacy');
    INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, reason, after)
    VALUES (NEW.admin_id, NEW.target_user_id, 'journal_access_requested', NEW.reason,
            jsonb_build_object('grant_id', NEW.id, 'mode', NEW.mode));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, reason, after)
    VALUES (NEW.admin_id, NEW.target_user_id,
            'journal_access_' || NEW.status, COALESCE(NEW.reason,''),
            jsonb_build_object('grant_id', NEW.id, 'mode', NEW.mode,
                               'actor', auth.uid(), 'expires_at', NEW.expires_at));

    IF NEW.status IN ('accepted','declined') AND NEW.admin_id <> COALESCE(auth.uid(), NEW.admin_id) THEN
      INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
      VALUES (NEW.admin_id, 'journal_access_' || NEW.status,
              'Journal access ' || NEW.status,
              'Your request for ' || NEW.mode || ' access was ' || NEW.status || '.',
              'journal_grant', NEW.id, '/admin/users/' || NEW.target_user_id::text);
    END IF;

    IF NEW.status IN ('revoked','expired') AND NEW.target_user_id <> COALESCE(auth.uid(), NEW.target_user_id) THEN
      INSERT INTO public.notifications (user_id, kind, title, ref_type, ref_id, link)
      VALUES (NEW.target_user_id, 'journal_access_' || NEW.status,
              'Journal access ' || NEW.status,
              'journal_grant', NEW.id, '/settings?tab=privacy');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.journal_access_log_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT COALESCE(full_name, 'A super admin') INTO v_admin_name
    FROM public.profiles WHERE id = NEW.admin_id;

  INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
  VALUES (NEW.target_user_id, 'journal_access_viewed',
          v_admin_name || ' viewed your Journal',
          CASE NEW.action WHEN 'edit' THEN 'They made an edit under an active write grant.'
                          WHEN 'list' THEN 'They opened the Journal list.'
                          ELSE 'They opened an entry under an active read grant.' END,
          'journal_grant', NEW.grant_id, '/settings?tab=privacy');

  INSERT INTO public.admin_audit_log (admin_id, target_user_id, action, after)
  VALUES (NEW.admin_id, NEW.target_user_id, 'journal_access_' || NEW.action,
          jsonb_build_object('grant_id', NEW.grant_id, 'note_id', NEW.note_id));
  RETURN NEW;
END $$;
