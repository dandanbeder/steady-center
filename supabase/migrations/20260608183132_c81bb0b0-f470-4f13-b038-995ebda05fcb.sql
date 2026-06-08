
-- ============ TIGHTEN SHARES INSERT / UPDATE ============
DROP POLICY IF EXISTS shares_insert ON public.shares;
DROP POLICY IF EXISTS shares_update ON public.shares;

CREATE POLICY shares_insert ON public.shares FOR INSERT TO authenticated
WITH CHECK (
  public.resource_owner(resource_type, resource_id) = auth.uid()
  OR public.is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.shares s2
    WHERE s2.grantee_user_id = auth.uid()
      AND s2.resource_type = shares.resource_type
      AND s2.resource_id = shares.resource_id
      AND s2.role = 'admin'
  )
);

CREATE POLICY shares_update ON public.shares FOR UPDATE TO authenticated
USING (
  public.resource_owner(resource_type, resource_id) = auth.uid()
  OR public.is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.shares s2
    WHERE s2.grantee_user_id = auth.uid()
      AND s2.resource_type = shares.resource_type
      AND s2.resource_id = shares.resource_id
      AND s2.role = 'admin'
  )
)
WITH CHECK (
  public.resource_owner(resource_type, resource_id) = auth.uid()
  OR public.is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.shares s2
    WHERE s2.grantee_user_id = auth.uid()
      AND s2.resource_type = shares.resource_type
      AND s2.resource_id = shares.resource_id
      AND s2.role = 'admin'
  )
);

-- ============ REALTIME COMMENTS CHANNEL AUTHORIZATION ============
-- Topic convention from client: "comments:<parent_type>:<parent_id>"
-- Allow subscribers only if they can_access the parent resource.

CREATE OR REPLACE FUNCTION public.realtime_comments_can_subscribe(_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parts text[];
  v_type text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF _topic IS NULL OR position('comments:' in _topic) <> 1 THEN
    RETURN false;
  END IF;
  parts := string_to_array(substring(_topic from 10), ':');
  IF array_length(parts, 1) < 2 THEN RETURN false; END IF;
  v_type := parts[1];
  BEGIN
    v_id := parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_type NOT IN ('task','note','event','meeting') THEN RETURN false; END IF;
  -- meeting parents are checked via meetings table (owner-only for now)
  IF v_type = 'meeting' THEN
    RETURN EXISTS (SELECT 1 FROM public.meetings WHERE id = v_id AND owner_id = auth.uid());
  END IF;
  RETURN public.can_access(auth.uid(), v_type, v_id, 'viewer');
END $$;
REVOKE EXECUTE ON FUNCTION public.realtime_comments_can_subscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.realtime_comments_can_subscribe(text) TO authenticated, service_role;

-- Add SELECT policy on realtime.messages for comments topics.
DROP POLICY IF EXISTS "realtime_comments_subscribe" ON realtime.messages;
CREATE POLICY "realtime_comments_subscribe"
ON realtime.messages FOR SELECT TO authenticated
USING (
  (realtime.topic() LIKE 'comments:%' AND public.realtime_comments_can_subscribe(realtime.topic()))
);
