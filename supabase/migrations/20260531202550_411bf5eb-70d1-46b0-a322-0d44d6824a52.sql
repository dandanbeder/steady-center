CREATE TABLE public.notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  business_id UUID,
  folder_id UUID,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner select notes" ON public.notes FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert notes" ON public.notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update notes" ON public.notes FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete notes" ON public.notes FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_notes_owner_business ON public.notes(owner_id, business_id);
CREATE INDEX idx_notes_folder ON public.notes(folder_id);