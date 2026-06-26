ALTER TABLE public.note_links DROP CONSTRAINT IF EXISTS note_links_to_type_check;
ALTER TABLE public.note_links ADD CONSTRAINT note_links_to_type_check
  CHECK (to_type = ANY (ARRAY['task','meeting','event','note','outcome']));