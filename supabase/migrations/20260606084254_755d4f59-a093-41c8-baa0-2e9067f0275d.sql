
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  ref_type text,
  ref_id uuid,
  link text,
  business_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_self" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE INDEX notifications_user_unread_idx ON public.notifications (user_id, read_at, created_at DESC);
CREATE INDEX notifications_user_created_idx ON public.notifications (user_id, created_at DESC);

-- Mention / tag notification
CREATE OR REPLACE FUNCTION public.notify_on_item_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_link text;
BEGIN
  IF NEW.tagged_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_title := 'You were mentioned in a ' || NEW.item_type;
  v_link := CASE NEW.item_type
    WHEN 'task' THEN '/tasks'
    WHEN 'note' THEN '/notes'
    WHEN 'event' THEN '/calendar'
    ELSE '/today'
  END;
  INSERT INTO public.notifications (user_id, kind, title, ref_type, ref_id, link, business_id)
  VALUES (NEW.tagged_user_id, 'mention', v_title, NEW.item_type, NEW.item_id, v_link, NEW.business_id);
  RETURN NEW;
END $$;

CREATE TRIGGER notify_item_tag_trg
  AFTER INSERT ON public.item_tags
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_item_tag();

-- Access request notification (to admins of the business)
CREATE OR REPLACE FUNCTION public.notify_on_access_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin record;
  v_req_name text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(full_name, '') INTO v_req_name FROM public.profiles WHERE id = NEW.requester_user_id;
  FOR v_admin IN
    SELECT m.user_id FROM public.memberships m
    WHERE m.business_id = NEW.business_id
      AND m.status = 'active'
      AND m.role::text IN ('admin','owner')
  LOOP
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link, business_id)
    VALUES (
      v_admin.user_id,
      'access_request',
      'New access request',
      COALESCE(NULLIF(v_req_name,''), 'Someone') || ' requested access',
      'access_request', NEW.id, '/settings', NEW.business_id
    );
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER notify_access_request_trg
  AFTER INSERT ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_access_request();

-- Meeting summary ready
CREATE OR REPLACE FUNCTION public.notify_on_meeting_summary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.summary, '') <> '' AND COALESCE(OLD.summary, '') = '' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link, business_id)
    VALUES (
      NEW.owner_id,
      'meeting_summary',
      'Meeting summary ready',
      NEW.title,
      'meeting', NEW.id, '/meetings/' || NEW.id::text, NEW.business_id
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notify_meeting_summary_trg
  AFTER INSERT OR UPDATE OF summary ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_meeting_summary();

-- Weekly report ready
CREATE OR REPLACE FUNCTION public.notify_on_weekly_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, ref_type, ref_id, link, business_id)
  VALUES (
    NEW.owner_id,
    'weekly_report',
    'Weekly review ready',
    'weekly_report', NEW.id, '/reports/' || NEW.id::text, NEW.business_id
  );
  RETURN NEW;
END $$;

CREATE TRIGGER notify_weekly_report_trg
  AFTER INSERT ON public.weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_weekly_report();

-- Reminder fired: when sent flips true, create a notification
CREATE OR REPLACE FUNCTION public.notify_on_reminder_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_body text;
  v_link text;
  v_event_title text;
  v_task_title text;
BEGIN
  IF NEW.sent = true AND COALESCE(OLD.sent, false) = false THEN
    IF NEW.ref_type = 'event' THEN
      SELECT title INTO v_event_title FROM public.events WHERE id = NEW.ref_id;
      v_title := COALESCE('Reminder: ' || v_event_title, 'Event reminder');
      v_link := '/calendar';
    ELSIF NEW.ref_type = 'task' THEN
      SELECT title INTO v_task_title FROM public.tasks WHERE id = NEW.ref_id;
      v_title := COALESCE('Task due: ' || v_task_title, 'Task reminder');
      v_link := '/tasks';
    ELSE
      v_title := 'Reminder';
      v_link := '/today';
    END IF;
    IF NEW.lead_minutes IS NOT NULL THEN
      v_body := 'In ' || NEW.lead_minutes || ' minutes';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, ref_type, ref_id, link)
    VALUES (NEW.owner_id, 'reminder', v_title, v_body, NEW.ref_type, NEW.ref_id, v_link);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notify_reminder_sent_trg
  AFTER UPDATE OF sent ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_reminder_sent();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
