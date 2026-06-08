
-- =========================================================
-- Comments + @mentions
-- =========================================================

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('task','note','event','meeting')),
  parent_id uuid NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  parent_owner_id uuid,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX comments_parent_idx ON public.comments (parent_type, parent_id, created_at);
CREATE INDEX comments_business_idx ON public.comments (business_id);
CREATE INDEX comments_author_idx ON public.comments (author_id);
CREATE INDEX comments_deleted_idx ON public.comments (deleted_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Helper: derive (business_id, owner_id) for a parent
CREATE OR REPLACE FUNCTION public.resolve_comment_parent(
  p_type text, p_id uuid,
  OUT business_id uuid, OUT owner_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_type = 'task' THEN
    SELECT t.business_id, t.owner_id INTO business_id, owner_id
      FROM public.tasks t WHERE t.id = p_id;
  ELSIF p_type = 'note' THEN
    SELECT n.business_id, n.owner_id INTO business_id, owner_id
      FROM public.notes n WHERE n.id = p_id;
  ELSIF p_type = 'event' THEN
    SELECT e.business_id, e.owner_id INTO business_id, owner_id
      FROM public.events e WHERE e.id = p_id;
  ELSIF p_type = 'meeting' THEN
    SELECT m.business_id, m.owner_id INTO business_id, owner_id
      FROM public.meetings m WHERE m.id = p_id;
  END IF;
END $$;

-- BEFORE INSERT trigger: derive business_id + parent_owner_id, verify access
CREATE OR REPLACE FUNCTION public.comments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz uuid;
  v_owner uuid;
BEGIN
  IF NEW.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'author_id must match caller';
  END IF;
  SELECT business_id, owner_id INTO v_biz, v_owner
    FROM public.resolve_comment_parent(NEW.parent_type, NEW.parent_id);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Parent not found';
  END IF;
  NEW.business_id := v_biz;
  NEW.parent_owner_id := v_owner;

  -- Authorization
  IF v_biz IS NULL THEN
    IF v_owner <> auth.uid() THEN
      RAISE EXCEPTION 'Not allowed to comment on this item';
    END IF;
  ELSE
    IF NOT (public.is_member(v_biz, 'commenter') OR public.is_platform_admin()) THEN
      RAISE EXCEPTION 'Not allowed to comment on this item';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER comments_before_insert
BEFORE INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.comments_before_insert();

-- BEFORE UPDATE: only author can edit body, set edited_at; immutable structural fields
CREATE OR REPLACE FUNCTION public.comments_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.author_id <> OLD.author_id
     OR NEW.parent_type <> OLD.parent_type
     OR NEW.parent_id <> OLD.parent_id
     OR COALESCE(NEW.business_id::text,'') <> COALESCE(OLD.business_id::text,'')
     OR COALESCE(NEW.parent_owner_id::text,'') <> COALESCE(OLD.parent_owner_id::text,'') THEN
    RAISE EXCEPTION 'Cannot change structural fields on a comment';
  END IF;
  IF NEW.body <> OLD.body THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER comments_before_update
BEFORE UPDATE ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.comments_before_update();

-- RLS policies
CREATE POLICY comments_select ON public.comments
  FOR SELECT TO authenticated
  USING (
    (business_id IS NOT NULL AND (public.is_member(business_id, 'viewer') OR public.is_platform_admin()))
    OR (business_id IS NULL AND parent_owner_id = auth.uid())
    OR author_id = auth.uid()
  );

CREATE POLICY comments_insert ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY comments_update_own ON public.comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY comments_delete_own ON public.comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- =========================================================
-- Comment mentions
-- =========================================================
CREATE TABLE public.comment_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, mentioned_user_id)
);

CREATE INDEX comment_mentions_user_idx ON public.comment_mentions (mentioned_user_id);
CREATE INDEX comment_mentions_comment_idx ON public.comment_mentions (comment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_mentions TO authenticated;
GRANT ALL ON public.comment_mentions TO service_role;

ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY comment_mentions_select ON public.comment_mentions
  FOR SELECT TO authenticated
  USING (
    mentioned_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.comments c
      WHERE c.id = comment_mentions.comment_id
        AND (
          (c.business_id IS NOT NULL AND (public.is_member(c.business_id,'viewer') OR public.is_platform_admin()))
          OR (c.business_id IS NULL AND c.parent_owner_id = auth.uid())
          OR c.author_id = auth.uid()
        )
    )
  );

-- Mentions are inserted by SECURITY DEFINER trigger only
CREATE POLICY comment_mentions_no_direct_write ON public.comment_mentions
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- Parse @[Name](uuid) tokens from body and:
--  * insert/refresh comment_mentions rows
--  * insert notifications for each newly-mentioned user
CREATE OR REPLACE FUNCTION public.comments_process_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m text[];
  uid uuid;
  v_label text;
  v_link text;
  v_author text;
BEGIN
  -- Skip if just soft-deleting
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Compute label/link
  v_label := CASE NEW.parent_type
    WHEN 'task' THEN 'task'
    WHEN 'note' THEN 'note'
    WHEN 'event' THEN 'event'
    WHEN 'meeting' THEN 'meeting'
  END;
  v_link := CASE NEW.parent_type
    WHEN 'task' THEN '/tasks?focus=' || NEW.parent_id::text || '#comment-' || NEW.id::text
    WHEN 'note' THEN '/notes?focus=' || NEW.parent_id::text || '#comment-' || NEW.id::text
    WHEN 'event' THEN '/calendar?focus=' || NEW.parent_id::text || '#comment-' || NEW.id::text
    WHEN 'meeting' THEN '/meetings/' || NEW.parent_id::text || '#comment-' || NEW.id::text
  END;
  SELECT COALESCE(full_name, '') INTO v_author FROM public.profiles WHERE id = NEW.author_id;

  -- Extract uuids from @[Name](uuid) tokens
  FOR m IN
    SELECT regexp_matches(
      NEW.body,
      '@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)',
      'g'
    )
  LOOP
    BEGIN
      uid := m[1]::uuid;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF uid = NEW.author_id THEN
      CONTINUE;
    END IF;

    -- Only notify users that can read this comment (members of biz or parent owner)
    IF NOT (
      (NEW.business_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.memberships mm
        WHERE mm.business_id = NEW.business_id AND mm.user_id = uid AND mm.status = 'active'
      ))
      OR (NEW.business_id IS NULL AND uid = NEW.parent_owner_id)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.comment_mentions (comment_id, mentioned_user_id)
    VALUES (NEW.id, uid)
    ON CONFLICT DO NOTHING;

    -- Notification (idempotent guard on ref+user)
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = uid
        AND n.kind = 'comment_mention'
        AND n.ref_type = 'comment'
        AND n.ref_id = NEW.id
    ) THEN
      INSERT INTO public.notifications
        (user_id, kind, title, body, ref_type, ref_id, link, business_id)
      VALUES (
        uid,
        'comment_mention',
        COALESCE(NULLIF(v_author,''),'Someone') || ' mentioned you in a ' || v_label,
        left(NEW.body, 240),
        'comment', NEW.id, v_link, NEW.business_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER comments_process_mentions_ins
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.comments_process_mentions();

CREATE TRIGGER comments_process_mentions_upd
AFTER UPDATE OF body ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.comments_process_mentions();

-- Extend purge_trash to also purge soft-deleted comments after 30 days
CREATE OR REPLACE FUNCTION public.purge_trash()
RETURNS TABLE(storage_paths text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  paths text[];
BEGIN
  SELECT COALESCE(array_agg(na.storage_path), ARRAY[]::text[])
    INTO paths
    FROM public.note_attachments na
    JOIN public.notes n ON n.id = na.note_id
   WHERE n.deleted_at IS NOT NULL AND n.deleted_at < now() - interval '30 days';

  DELETE FROM public.tasks    WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.notes    WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.events   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.lists    WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.folders  WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.comments WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';

  RETURN QUERY SELECT paths;
END;
$function$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
ALTER TABLE public.comments REPLICA IDENTITY FULL;
