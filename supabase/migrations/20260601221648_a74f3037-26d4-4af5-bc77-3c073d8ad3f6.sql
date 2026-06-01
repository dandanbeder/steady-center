-- Link tasks back to their source note (for AI-extracted action items)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type text;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_source_type_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('note','meeting','manual'));

CREATE INDEX IF NOT EXISTS tasks_source_note_id_idx
  ON public.tasks(source_note_id) WHERE source_note_id IS NOT NULL;
