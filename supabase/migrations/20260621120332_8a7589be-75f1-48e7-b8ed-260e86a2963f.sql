
-- Allow 'business' as a resource_type in shares
ALTER TABLE public.shares DROP CONSTRAINT IF EXISTS shares_resource_type_check;
ALTER TABLE public.shares ADD CONSTRAINT shares_resource_type_check
  CHECK (resource_type IN ('folder','list','task','note','calendar','business'));

-- Extend resource_owner() to know about businesses
CREATE OR REPLACE FUNCTION public.resource_owner(_type text, _id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  ELSIF _type = 'business' THEN
    SELECT owner_id INTO v_owner FROM businesses WHERE id = _id;
  END IF;
  RETURN v_owner;
END $$;

-- Helper: business_id for a resource
CREATE OR REPLACE FUNCTION public.resource_business(_type text, _id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  END IF;
  RETURN v_biz;
END $$;
REVOKE EXECUTE ON FUNCTION public.resource_business(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resource_business(text,uuid) TO authenticated, service_role;

-- Extend can_access() to honour Account-scope shares.
-- Journal notes are skipped: a business share never grants access to note_type='journal'.
CREATE OR REPLACE FUNCTION public.can_access(_user uuid, _type text, _id uuid, _min_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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

  -- Platform admin always
  IF EXISTS (SELECT 1 FROM profiles WHERE id = _user AND platform_role = 'superadmin') THEN
    RETURN true;
  END IF;

  -- Owner check
  v_owner := resource_owner(v_type, _id);
  IF v_owner = _user THEN RETURN true; END IF;

  -- Direct share on the resource
  IF EXISTS (
    SELECT 1 FROM shares s
    WHERE s.grantee_user_id = _user
      AND s.resource_type = v_type
      AND s.resource_id = _id
      AND role_rank(s.role) >= v_min
  ) THEN RETURN true; END IF;

  -- Account-scope share (excludes journal notes)
  IF v_type IN ('folder','list','task','note','calendar','event') THEN
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
    END IF;
  END IF;

  -- Implicit: assignee of a task gets viewer
  IF v_type = 'task' AND v_min <= role_rank('viewer') THEN
    IF EXISTS (SELECT 1 FROM tasks WHERE id = _id AND assignee_id = _user) THEN
      RETURN true;
    END IF;
  END IF;

  -- Ancestor walks
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
END $$;

-- Update shares_guard to:
--  * Forbid sharing journal notes (existing)
--  * For 'business' shares: only Account owner / admin / platform admin can grant; can't grant to the owner
CREATE OR REPLACE FUNCTION public.shares_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_ntype text;
BEGIN
  IF NEW.resource_type = 'note' THEN
    SELECT note_type INTO v_ntype FROM notes WHERE id = NEW.resource_id;
    IF v_ntype = 'journal' THEN
      RAISE EXCEPTION 'Journal notes cannot be shared';
    END IF;
  END IF;

  v_owner := resource_owner(NEW.resource_type, NEW.resource_id);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Resource not found';
  END IF;
  IF NEW.grantee_user_id = v_owner THEN
    RAISE EXCEPTION 'Owner already has full access';
  END IF;

  IF NEW.resource_type = 'business' THEN
    -- Only Account owner or team admin or platform admin can grant
    IF v_owner <> auth.uid()
       AND NOT public.is_member(NEW.resource_id, 'admin')
       AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND platform_role = 'superadmin') THEN
      RAISE EXCEPTION 'Not allowed to grant Account access';
    END IF;
  ELSE
    -- Resource-level share: owner / admin-share / platform admin
    IF v_owner <> auth.uid()
       AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND platform_role='superadmin')
       AND NOT EXISTS (
         SELECT 1 FROM shares s
         WHERE s.grantee_user_id = auth.uid()
           AND s.resource_type = NEW.resource_type
           AND s.resource_id = NEW.resource_id
           AND s.role = 'admin'
       ) THEN
      RAISE EXCEPTION 'Not allowed to share this resource';
    END IF;
  END IF;

  IF NEW.granted_by IS NULL THEN NEW.granted_by := auth.uid(); END IF;
  RETURN NEW;
END $$;

-- shares select/delete need to let Account owners / admins see+revoke business-scope rows
DROP POLICY IF EXISTS shares_select ON public.shares;
CREATE POLICY shares_select ON public.shares FOR SELECT TO authenticated
USING (
  grantee_user_id = auth.uid()
  OR granted_by = auth.uid()
  OR resource_owner(resource_type, resource_id) = auth.uid()
  OR is_platform_admin()
  OR (resource_type = 'business' AND public.is_member(resource_id, 'admin'))
);

DROP POLICY IF EXISTS shares_delete ON public.shares;
CREATE POLICY shares_delete ON public.shares FOR DELETE TO authenticated
USING (
  resource_owner(resource_type, resource_id) = auth.uid()
  OR is_platform_admin()
  OR (resource_type = 'business' AND public.is_member(resource_id, 'admin'))
  OR EXISTS (
    SELECT 1 FROM shares s2 WHERE s2.grantee_user_id = auth.uid()
      AND s2.resource_type = shares.resource_type
      AND s2.resource_id = shares.resource_id
      AND s2.role = 'admin'
  )
);

DROP POLICY IF EXISTS shares_update ON public.shares;
CREATE POLICY shares_update ON public.shares FOR UPDATE TO authenticated
USING (
  resource_owner(resource_type, resource_id) = auth.uid()
  OR is_platform_admin()
  OR (resource_type = 'business' AND public.is_member(resource_id, 'admin'))
)
WITH CHECK (true);
