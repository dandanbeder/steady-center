
-- 1. Add deleted_at columns
ALTER TABLE public.tasks   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.notes   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.events  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.lists   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Partial indexes for fast "active" queries and trash listings
CREATE INDEX IF NOT EXISTS idx_tasks_active   ON public.tasks   (list_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_trash    ON public.tasks   (deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_active   ON public.notes   (business_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_trash    ON public.notes   (deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_active  ON public.events  (calendar_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_trash   ON public.events  (deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_active ON public.folders (business_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folders_trash  ON public.folders (deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lists_active   ON public.lists   (folder_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lists_trash    ON public.lists   (deleted_at)    WHERE deleted_at IS NOT NULL;

-- 3. Cascade trigger: when a folder or list is soft-deleted/restored, mirror to children
CREATE OR REPLACE FUNCTION public.cascade_soft_delete_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ts timestamptz;
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    ts := NEW.deleted_at;
    -- Cascade: child folders, lists, notes (in this folder), tasks (in lists in this folder)
    IF ts IS NOT NULL THEN
      -- DELETE cascade: only touch currently-active rows so a separately-deleted row keeps its timestamp
      WITH RECURSIVE descendants AS (
        SELECT id FROM public.folders WHERE id = NEW.id
        UNION ALL
        SELECT f.id FROM public.folders f JOIN descendants d ON f.parent_folder_id = d.id WHERE f.deleted_at IS NULL
      )
      UPDATE public.folders SET deleted_at = ts
       WHERE id IN (SELECT id FROM descendants) AND id <> NEW.id AND deleted_at IS NULL;

      UPDATE public.notes SET deleted_at = ts
       WHERE folder_id IN (
         WITH RECURSIVE descendants AS (
           SELECT id FROM public.folders WHERE id = NEW.id
           UNION ALL
           SELECT f.id FROM public.folders f JOIN descendants d ON f.parent_folder_id = d.id
         ) SELECT id FROM descendants
       ) AND deleted_at IS NULL;

      UPDATE public.lists SET deleted_at = ts
       WHERE folder_id IN (
         WITH RECURSIVE descendants AS (
           SELECT id FROM public.folders WHERE id = NEW.id
           UNION ALL
           SELECT f.id FROM public.folders f JOIN descendants d ON f.parent_folder_id = d.id
         ) SELECT id FROM descendants
       ) AND deleted_at IS NULL;

      UPDATE public.tasks SET deleted_at = ts
       WHERE list_id IN (
         SELECT l.id FROM public.lists l WHERE l.folder_id IN (
           WITH RECURSIVE descendants AS (
             SELECT id FROM public.folders WHERE id = NEW.id
             UNION ALL
             SELECT f.id FROM public.folders f JOIN descendants d ON f.parent_folder_id = d.id
           ) SELECT id FROM descendants
         )
       ) AND deleted_at IS NULL;
    ELSE
      -- RESTORE cascade: bring back rows that were soft-deleted at the same moment as this folder
      UPDATE public.folders SET deleted_at = NULL
       WHERE parent_folder_id = NEW.id AND deleted_at = OLD.deleted_at;
      UPDATE public.notes SET deleted_at = NULL
       WHERE folder_id = NEW.id AND deleted_at = OLD.deleted_at;
      UPDATE public.lists SET deleted_at = NULL
       WHERE folder_id = NEW.id AND deleted_at = OLD.deleted_at;
      UPDATE public.tasks SET deleted_at = NULL
       WHERE list_id IN (SELECT id FROM public.lists WHERE folder_id = NEW.id)
         AND deleted_at = OLD.deleted_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cascade_soft_delete_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF NEW.deleted_at IS NOT NULL THEN
      UPDATE public.tasks SET deleted_at = NEW.deleted_at
       WHERE list_id = NEW.id AND deleted_at IS NULL;
    ELSE
      UPDATE public.tasks SET deleted_at = NULL
       WHERE list_id = NEW.id AND deleted_at = OLD.deleted_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_folders_cascade_soft_delete ON public.folders;
CREATE TRIGGER trg_folders_cascade_soft_delete
AFTER UPDATE OF deleted_at ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.cascade_soft_delete_folder();

DROP TRIGGER IF EXISTS trg_lists_cascade_soft_delete ON public.lists;
CREATE TRIGGER trg_lists_cascade_soft_delete
AFTER UPDATE OF deleted_at ON public.lists
FOR EACH ROW EXECUTE FUNCTION public.cascade_soft_delete_list();

-- 4. Purge function: hard-delete rows older than 30 days, return note attachment paths to scrub from storage
CREATE OR REPLACE FUNCTION public.purge_trash()
RETURNS TABLE(storage_paths text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  paths text[];
BEGIN
  -- collect note attachment storage paths for notes about to be purged
  SELECT COALESCE(array_agg(na.storage_path), ARRAY[]::text[])
    INTO paths
    FROM public.note_attachments na
    JOIN public.notes n ON n.id = na.note_id
   WHERE n.deleted_at IS NOT NULL AND n.deleted_at < now() - interval '30 days';

  DELETE FROM public.tasks   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.notes   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.events  WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.lists   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.folders WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';

  RETURN QUERY SELECT paths;
END;
$$;

-- 5. list_trash: return current user's soft-deleted items grouped by type
CREATE OR REPLACE FUNCTION public.list_trash()
RETURNS TABLE(
  kind text,
  id uuid,
  title text,
  business_id uuid,
  deleted_at timestamptz,
  parent_id uuid,
  meta jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT 'task'::text, t.id, t.title, t.business_id, t.deleted_at, t.list_id, jsonb_build_object('status', t.status, 'due_at', t.due_at)
    FROM public.tasks t
   WHERE t.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'note'::text, n.id, n.title, n.business_id, n.deleted_at, n.folder_id, jsonb_build_object('note_type', n.note_type)
    FROM public.notes n
   WHERE n.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'event'::text, e.id, e.title, e.business_id, e.deleted_at, e.calendar_id, jsonb_build_object('start_at', e.start_at, 'calendar_id', e.calendar_id)
    FROM public.events e
   WHERE e.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'list'::text, l.id, l.name, public.business_for_list(l.id), l.deleted_at, l.folder_id, '{}'::jsonb
    FROM public.lists l
   WHERE l.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'folder'::text, f.id, f.name, f.business_id, f.deleted_at, f.parent_folder_id, '{}'::jsonb
    FROM public.folders f
   WHERE f.deleted_at IS NOT NULL
  ORDER BY 5 DESC;
$$;

-- 6. empty_trash: hard delete all current user's soft-deleted rows
CREATE OR REPLACE FUNCTION public.empty_my_trash()
RETURNS TABLE(storage_paths text[])
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  paths text[];
BEGIN
  SELECT COALESCE(array_agg(na.storage_path), ARRAY[]::text[])
    INTO paths
    FROM public.note_attachments na
    JOIN public.notes n ON n.id = na.note_id
   WHERE n.deleted_at IS NOT NULL;

  DELETE FROM public.tasks   WHERE deleted_at IS NOT NULL;
  DELETE FROM public.notes   WHERE deleted_at IS NOT NULL;
  DELETE FROM public.events  WHERE deleted_at IS NOT NULL;
  DELETE FROM public.lists   WHERE deleted_at IS NOT NULL;
  DELETE FROM public.folders WHERE deleted_at IS NOT NULL;

  RETURN QUERY SELECT paths;
END;
$$;
