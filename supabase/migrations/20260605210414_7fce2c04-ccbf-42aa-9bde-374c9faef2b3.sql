
CREATE TABLE public.inbox_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text text NOT NULL,
  source text NOT NULL DEFAULT 'quick_add',
  status text NOT NULL DEFAULT 'pending',
  suggested_type text,
  suggested_title text,
  suggested_body text,
  suggested_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  suggested_folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  suggested_list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL,
  suggested_priority text,
  suggested_due_at timestamptz,
  ai_processed_at timestamptz,
  ai_raw jsonb,
  resulting_ref_type text,
  resulting_ref_id uuid,
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbox_owner_status ON public.inbox_items (owner_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_items TO authenticated;
GRANT ALL ON public.inbox_items TO service_role;

ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inbox_select_own" ON public.inbox_items FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "inbox_insert_own" ON public.inbox_items FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "inbox_update_own" ON public.inbox_items FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "inbox_delete_own" ON public.inbox_items FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER trg_inbox_items_updated_at
  BEFORE UPDATE ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
