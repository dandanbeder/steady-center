
-- 1) item_tags table
CREATE TABLE public.item_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('task','note','event')),
  item_id uuid NOT NULL,
  business_id uuid NOT NULL,
  tagged_email text NOT NULL,
  tagged_user_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_id, tagged_email)
);

CREATE INDEX item_tags_lookup_by_item ON public.item_tags (item_type, item_id);
CREATE INDEX item_tags_user_idx ON public.item_tags (tagged_user_id) WHERE tagged_user_id IS NOT NULL;
CREATE INDEX item_tags_email_idx ON public.item_tags (lower(tagged_email));
CREATE INDEX item_tags_business_idx ON public.item_tags (business_id);

-- Normalize email
CREATE OR REPLACE FUNCTION public.item_tags_normalize_email()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.tagged_email := lower(trim(NEW.tagged_email));
  -- Auto-link tagged_user_id if a user with that email already exists
  IF NEW.tagged_user_id IS NULL THEN
    SELECT u.id INTO NEW.tagged_user_id
    FROM auth.users u
    WHERE lower(u.email) = NEW.tagged_email
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER item_tags_normalize_email_trg
BEFORE INSERT OR UPDATE ON public.item_tags
FOR EACH ROW EXECUTE FUNCTION public.item_tags_normalize_email();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_tags TO authenticated;
GRANT ALL ON public.item_tags TO service_role;

ALTER TABLE public.item_tags ENABLE ROW LEVEL SECURITY;

-- A user can see a tag row if they are the tagged user, or a viewer of the business
CREATE POLICY item_tags_select ON public.item_tags
  FOR SELECT TO authenticated
  USING (
    tagged_user_id = auth.uid()
    OR public.is_member(business_id, 'viewer')
    OR public.is_platform_admin()
  );

-- Only members (>=member) of the business can add tags
CREATE POLICY item_tags_insert_member ON public.item_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_member(business_id, 'member')
    OR public.is_platform_admin()
  );

CREATE POLICY item_tags_update_member ON public.item_tags
  FOR UPDATE TO authenticated
  USING (public.is_member(business_id, 'member') OR public.is_platform_admin())
  WITH CHECK (public.is_member(business_id, 'member') OR public.is_platform_admin());

-- Members of the business OR the original tagger can remove a tag.
-- A tagged user can also remove themselves.
CREATE POLICY item_tags_delete ON public.item_tags
  FOR DELETE TO authenticated
  USING (
    public.is_member(business_id, 'member')
    OR public.is_platform_admin()
    OR created_by = auth.uid()
    OR tagged_user_id = auth.uid()
  );

-- 2) Helper: is_tagged on (item_type, item_id) for current user
CREATE OR REPLACE FUNCTION public.is_tagged(p_item_type text, p_item_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.item_tags
    WHERE item_type = p_item_type
      AND item_id = p_item_id
      AND tagged_user_id = auth.uid()
  )
$$;

-- 3) Extend SELECT policies on tasks/notes/events to allow tagged users
CREATE POLICY tasks_select_tagged ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_tagged('task', id));

CREATE POLICY notes_select_tagged ON public.notes
  FOR SELECT TO authenticated
  USING (public.is_tagged('note', id));

CREATE POLICY events_select_tagged ON public.events
  FOR SELECT TO authenticated
  USING (public.is_tagged('event', id));

-- 4) On signup, claim tags by email → set tagged_user_id
CREATE OR REPLACE FUNCTION public.claim_item_tags_for_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE public.item_tags
     SET tagged_user_id = NEW.id
   WHERE tagged_user_id IS NULL
     AND lower(tagged_email) = lower(NEW.email);
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_item_tags_for_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created_claim_item_tags
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.claim_item_tags_for_new_user();
