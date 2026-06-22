-- Helper: tells whether the given users currently have access to a comment parent.
CREATE OR REPLACE FUNCTION public.check_comment_mention_access(
  p_parent_type text,
  p_parent_id   uuid,
  p_user_ids    uuid[]
)
RETURNS TABLE(user_id uuid, has_access boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_biz uuid;
  v_owner uuid;
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  SELECT business_id, owner_id INTO v_biz, v_owner
    FROM public.resolve_comment_parent(p_parent_type, p_parent_id);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Parent not found';
  END IF;

  RETURN QUERY
    SELECT u AS user_id,
           (
             -- Owner of the item always has access
             u = v_owner
             -- Active member of the parent's business
             OR (v_biz IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.memberships mm
                   WHERE mm.business_id = v_biz
                     AND mm.user_id = u
                     AND mm.status = 'active'
                ))
             -- Explicit share grantee on this exact resource
             OR EXISTS (
                   SELECT 1 FROM public.shares s
                   WHERE s.grantee_user_id = u
                     AND s.resource_type = p_parent_type
                     AND s.resource_id = p_parent_id
                )
             -- Platform admin (super)
             OR EXISTS (
                   SELECT 1 FROM public.profiles p
                   WHERE p.id = u AND p.platform_role = 'superadmin'
                )
           ) AS has_access
    FROM unnest(p_user_ids) AS u;
END $$;
REVOKE ALL ON FUNCTION public.check_comment_mention_access(text, uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.check_comment_mention_access(text, uuid, uuid[]) TO authenticated, service_role;

-- Helper: items the signed-in user was mentioned in recently. Used to surface
-- @mentions in "Shared with me" even when the mentioning didn't create a
-- formal share row (because the user already had access via business
-- membership). RLS on comments still gates the underlying read.
CREATE OR REPLACE FUNCTION public.list_my_mention_items(p_days integer DEFAULT 60)
RETURNS TABLE(
  parent_type text,
  parent_id   uuid,
  business_id uuid,
  last_mentioned_at timestamptz,
  last_mentioned_by uuid
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.parent_type::text,
         c.parent_id,
         c.business_id,
         max(c.created_at) AS last_mentioned_at,
         (array_agg(c.author_id ORDER BY c.created_at DESC))[1] AS last_mentioned_by
  FROM public.comment_mentions cm
  JOIN public.comments c ON c.id = cm.comment_id
  WHERE cm.mentioned_user_id = auth.uid()
    AND c.deleted_at IS NULL
    AND c.created_at > now() - (p_days || ' days')::interval
  GROUP BY c.parent_type, c.parent_id, c.business_id;
$$;
REVOKE ALL ON FUNCTION public.list_my_mention_items(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.list_my_mention_items(integer) TO authenticated, service_role;