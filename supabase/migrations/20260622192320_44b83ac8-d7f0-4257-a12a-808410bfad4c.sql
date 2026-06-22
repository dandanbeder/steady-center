
-- 1) Allow 'meeting' in shares.resource_type
ALTER TABLE public.shares DROP CONSTRAINT IF EXISTS shares_resource_type_check;
ALTER TABLE public.shares ADD CONSTRAINT shares_resource_type_check
  CHECK (resource_type = ANY (ARRAY['folder','list','task','note','calendar','business','meeting']));

-- 2) Teach resource_owner about meetings
CREATE OR REPLACE FUNCTION public.resource_owner(_type text, _id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid;
BEGIN
  IF _type = 'folder' OR _type = 'note_folder' THEN
    SELECT owner_id INTO v_owner FROM folders WHERE id = _id;
  ELSIF _type = 'list' THEN
    SELECT owner_id INTO v_owner FROM lists WHERE id = _id;
  ELSIF _type = 'task' THEN
    SELECT owner_id INTO v_owner FROM tasks WHERE id = _id;
  ELSIF _type = 'note' THEN
    SELECT owner_id INTO v_owner FROM notes WHERE id = _id;
  ELSIF _type = 'calendar' THEN
    SELECT owner_id INTO v_owner FROM calendars WHERE id = _id;
  ELSIF _type = 'event' THEN
    SELECT owner_id INTO v_owner FROM events WHERE id = _id;
  ELSIF _type = 'meeting' THEN
    SELECT owner_id INTO v_owner FROM meetings WHERE id = _id;
  ELSIF _type = 'business' THEN
    SELECT owner_id INTO v_owner FROM businesses WHERE id = _id;
  END IF;
  RETURN v_owner;
END $function$;

-- 3) Teach resource_business about meetings
CREATE OR REPLACE FUNCTION public.resource_business(_type text, _id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_biz uuid; v_folder uuid; v_list uuid; v_cal uuid;
BEGIN
  IF _id IS NULL THEN RETURN NULL; END IF;
  IF _type = 'folder' THEN
    SELECT business_id INTO v_biz FROM folders WHERE id = _id;
  ELSIF _type = 'list' THEN
    SELECT folder_id INTO v_folder FROM lists WHERE id = _id;
    IF v_folder IS NOT NULL THEN
      SELECT business_id INTO v_biz FROM folders WHERE id = v_folder;
    END IF;
  ELSIF _type = 'task' THEN
    SELECT business_id INTO v_biz FROM tasks WHERE id = _id;
  ELSIF _type = 'note' THEN
    SELECT business_id INTO v_biz FROM notes WHERE id = _id;
  ELSIF _type = 'calendar' THEN
    SELECT business_id INTO v_biz FROM calendars WHERE id = _id;
  ELSIF _type = 'event' THEN
    SELECT calendar_id INTO v_cal FROM events WHERE id = _id;
    IF v_cal IS NOT NULL THEN
      SELECT business_id INTO v_biz FROM calendars WHERE id = v_cal;
    END IF;
  ELSIF _type = 'meeting' THEN
    SELECT business_id INTO v_biz FROM meetings WHERE id = _id;
  END IF;
  RETURN v_biz;
END $function$;

-- 4) Extend can_access to include meeting in business-scope share fallback
CREATE OR REPLACE FUNCTION public.can_access(_user uuid, _type text, _id uuid, _min_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_min int := role_rank(_min_role);
  v_type text := CASE _type WHEN 'note_folder' THEN 'folder' ELSE _type END;
  v_folder_id uuid;
  v_calendar_id uuid;
  v_list_id uuid;
  v_business_id uuid;
  v_note_type text;
BEGIN
  IF _user IS NULL OR _id IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = _user AND platform_role = 'superadmin') THEN
    RETURN true;
  END IF;

  v_owner := resource_owner(v_type, _id);
  IF v_owner = _user THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM shares s
    WHERE s.grantee_user_id = _user
      AND s.resource_type = v_type
      AND s.resource_id = _id
      AND role_rank(s.role) >= v_min
  ) THEN RETURN true; END IF;

  IF v_type IN ('folder','list','task','note','calendar','event','meeting') THEN
    v_business_id := resource_business(v_type, _id);
    IF v_business_id IS NOT NULL THEN
      IF v_type = 'note' THEN
        SELECT note_type INTO v_note_type FROM notes WHERE id = _id;
      END IF;
      IF COALESCE(v_note_type, '') <> 'journal' AND EXISTS (
        SELECT 1 FROM shares s
        WHERE s.grantee_user_id = _user
          AND s.resource_type = 'business'
          AND s.resource_id = v_business_id
          AND role_rank(s.role) >= v_min
      ) THEN
        RETURN true;
      END IF;
      -- Active membership of the business with a sufficient role
      IF EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.business_id = v_business_id
          AND m.user_id = _user
          AND m.status = 'active'
          AND role_rank(
            CASE m.role
              WHEN 'owner' THEN 'admin'
              WHEN 'admin' THEN 'admin'
              WHEN 'member' THEN 'member'
              WHEN 'commenter' THEN 'commenter'
              ELSE 'viewer'
            END
          ) >= v_min
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  IF v_type = 'task' AND v_min <= role_rank('viewer') THEN
    IF EXISTS (SELECT 1 FROM tasks WHERE id = _id AND assignee_id = _user) THEN
      RETURN true;
    END IF;
  END IF;

  IF v_type = 'event' THEN
    SELECT calendar_id INTO v_calendar_id FROM events WHERE id = _id;
    IF v_calendar_id IS NOT NULL THEN
      IF can_access(_user, 'calendar', v_calendar_id, _min_role) THEN RETURN true; END IF;
    END IF;
    RETURN false;
  END IF;

  IF v_type = 'task' THEN
    SELECT list_id INTO v_list_id FROM tasks WHERE id = _id;
    IF v_list_id IS NOT NULL THEN
      IF can_access(_user, 'list', v_list_id, _min_role) THEN RETURN true; END IF;
    END IF;
    RETURN false;
  END IF;

  IF v_type = 'list' THEN
    SELECT folder_id INTO v_folder_id FROM lists WHERE id = _id;
    IF v_folder_id IS NOT NULL THEN
      IF can_access(_user, 'folder', v_folder_id, _min_role) THEN RETURN true; END IF;
    END IF;
    RETURN false;
  END IF;

  IF v_type = 'note' THEN
    SELECT folder_id INTO v_folder_id FROM notes WHERE id = _id;
    IF v_folder_id IS NOT NULL THEN
      IF can_access(_user, 'folder', v_folder_id, _min_role) THEN RETURN true; END IF;
    END IF;
    RETURN false;
  END IF;

  IF v_type = 'folder' THEN
    DECLARE cur uuid; depth int := 0; BEGIN
      SELECT parent_folder_id INTO cur FROM folders WHERE id = _id;
      WHILE cur IS NOT NULL AND depth < 10 LOOP
        IF resource_owner('folder', cur) = _user THEN RETURN true; END IF;
        IF EXISTS (
          SELECT 1 FROM shares s WHERE s.grantee_user_id = _user
            AND s.resource_type = 'folder' AND s.resource_id = cur
            AND role_rank(s.role) >= v_min
        ) THEN RETURN true; END IF;
        SELECT parent_folder_id INTO cur FROM folders WHERE id = cur;
        depth := depth + 1;
      END LOOP;
    END;
    RETURN false;
  END IF;

  RETURN false;
END $function$;

-- 5) Replace owner-only SELECT on meetings; keep INSERT owner-only.
DROP POLICY IF EXISTS meetings_select_owner ON public.meetings;
CREATE POLICY meetings_select ON public.meetings
  FOR SELECT TO authenticated
  USING (can_access(auth.uid(), 'meeting', id, 'viewer'));

-- Allow members with at least 'member' role to comment-via-update? Keep update owner-only.
-- (Editing the note stays with the owner; sharers can still comment via comments table.)

-- 6) Meeting decisions visible to anyone who can view the meeting
DROP POLICY IF EXISTS meeting_decisions_owner_select ON public.meeting_decisions;
CREATE POLICY meeting_decisions_select ON public.meeting_decisions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_id
    OR can_access(auth.uid(), 'meeting', meeting_id, 'viewer')
  );
