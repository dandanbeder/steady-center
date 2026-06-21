
CREATE TABLE public.journal_meta (
  note_id UUID PRIMARY KEY REFERENCES public.notes(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  mood SMALLINT CHECK (mood IS NULL OR (mood >= 1 AND mood <= 5)),
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_meta TO authenticated;
GRANT ALL ON public.journal_meta TO service_role;

ALTER TABLE public.journal_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY journal_meta_owner_select ON public.journal_meta
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY journal_meta_owner_insert ON public.journal_meta
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY journal_meta_owner_update ON public.journal_meta
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY journal_meta_owner_delete ON public.journal_meta
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER trg_journal_meta_updated
  BEFORE UPDATE ON public.journal_meta
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_journal_meta_owner ON public.journal_meta(owner_id);
