
ALTER TABLE public.tasks   ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.notes   ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.events  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lists   ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_deleted_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    NEW.deleted_by := CASE WHEN NEW.deleted_at IS NULL THEN NULL ELSE COALESCE(auth.uid(), NEW.deleted_by) END;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_deleted_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tasks_set_deleted_by   ON public.tasks;
DROP TRIGGER IF EXISTS trg_notes_set_deleted_by   ON public.notes;
DROP TRIGGER IF EXISTS trg_events_set_deleted_by  ON public.events;
DROP TRIGGER IF EXISTS trg_lists_set_deleted_by   ON public.lists;
DROP TRIGGER IF EXISTS trg_folders_set_deleted_by ON public.folders;
CREATE TRIGGER trg_tasks_set_deleted_by   BEFORE UPDATE OF deleted_at ON public.tasks   FOR EACH ROW EXECUTE FUNCTION public.set_deleted_by();
CREATE TRIGGER trg_notes_set_deleted_by   BEFORE UPDATE OF deleted_at ON public.notes   FOR EACH ROW EXECUTE FUNCTION public.set_deleted_by();
CREATE TRIGGER trg_events_set_deleted_by  BEFORE UPDATE OF deleted_at ON public.events  FOR EACH ROW EXECUTE FUNCTION public.set_deleted_by();
CREATE TRIGGER trg_lists_set_deleted_by   BEFORE UPDATE OF deleted_at ON public.lists   FOR EACH ROW EXECUTE FUNCTION public.set_deleted_by();
CREATE TRIGGER trg_folders_set_deleted_by BEFORE UPDATE OF deleted_at ON public.folders FOR EACH ROW EXECUTE FUNCTION public.set_deleted_by();

DROP FUNCTION IF EXISTS public.list_trash();
CREATE FUNCTION public.list_trash()
RETURNS TABLE(
  kind text, id uuid, title text, business_id uuid, deleted_at timestamptz,
  parent_id uuid, meta jsonb, deleted_by uuid, deleted_by_name text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH rows AS (
    SELECT 'task'::text AS kind, t.id, t.title, t.business_id, t.deleted_at, t.list_id AS parent_id,
           jsonb_build_object('status', t.status, 'due_at', t.due_at) AS meta, t.deleted_by
      FROM public.tasks t WHERE t.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'note', n.id, n.title, n.business_id, n.deleted_at, n.folder_id,
           jsonb_build_object('note_type', n.note_type), n.deleted_by
      FROM public.notes n WHERE n.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'event', e.id, e.title, e.business_id, e.deleted_at, e.calendar_id,
           jsonb_build_object('start_at', e.start_at, 'calendar_id', e.calendar_id), e.deleted_by
      FROM public.events e WHERE e.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'list', l.id, l.name, public.business_for_list(l.id), l.deleted_at, l.folder_id,
           '{}'::jsonb, l.deleted_by
      FROM public.lists l WHERE l.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'folder', f.id, f.name, f.business_id, f.deleted_at, f.parent_folder_id,
           '{}'::jsonb, f.deleted_by
      FROM public.folders f WHERE f.deleted_at IS NOT NULL
  )
  SELECT r.kind, r.id, r.title, r.business_id, r.deleted_at, r.parent_id, r.meta,
         r.deleted_by,
         NULLIF(TRIM(p.full_name), '')::text AS deleted_by_name
    FROM rows r
    LEFT JOIN public.profiles p ON p.id = r.deleted_by
   ORDER BY r.deleted_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.list_trash() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_trash() TO authenticated;
