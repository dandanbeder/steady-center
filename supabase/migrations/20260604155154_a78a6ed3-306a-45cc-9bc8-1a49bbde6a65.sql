
ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS parent_folder_id uuid NULL
  REFERENCES public.folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_folders_parent ON public.folders(parent_folder_id);

CREATE OR REPLACE FUNCTION public.folders_validate_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  depth int := 1;
  cur uuid := NEW.parent_folder_id;
  parent_biz uuid;
BEGIN
  IF NEW.parent_folder_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_folder_id = NEW.id THEN
    RAISE EXCEPTION 'Folder cannot be its own parent';
  END IF;
  WHILE cur IS NOT NULL LOOP
    IF depth > 3 THEN
      RAISE EXCEPTION 'Folder nesting limited to 3 levels';
    END IF;
    SELECT parent_folder_id, business_id INTO cur, parent_biz
      FROM public.folders WHERE id = cur;
    IF parent_biz IS NOT NULL AND parent_biz <> NEW.business_id THEN
      RAISE EXCEPTION 'Parent folder must belong to the same account';
    END IF;
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Folder cycle detected';
    END IF;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS folders_validate_parent_trg ON public.folders;
CREATE TRIGGER folders_validate_parent_trg
BEFORE INSERT OR UPDATE OF parent_folder_id, business_id ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.folders_validate_parent();
