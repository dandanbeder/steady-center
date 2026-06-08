
-- Guard against silent ownership/parent reassignment by non-owners.
CREATE OR REPLACE FUNCTION public.guard_ownership_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean := false;
  v_is_admin boolean := false;
BEGIN
  -- Determine owner of OLD row
  v_is_owner := (OLD.owner_id = auth.uid());
  v_is_admin := is_platform_admin();

  IF v_is_owner OR v_is_admin THEN
    RETURN NEW;
  END IF;

  -- owner_id must never change for non-owners
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Only the owner can transfer ownership of this %', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  -- Per-table parent / privileged column locks
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
      RAISE EXCEPTION 'Only the owner can move this task to a different list'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      RAISE EXCEPTION 'Only the owner can change the assignee of this task'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'notes' THEN
    IF NEW.folder_id IS DISTINCT FROM OLD.folder_id THEN
      RAISE EXCEPTION 'Only the owner can move this note to a different folder'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'lists' THEN
    IF NEW.folder_id IS DISTINCT FROM OLD.folder_id THEN
      RAISE EXCEPTION 'Only the owner can move this list to a different folder'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'events' THEN
    IF NEW.calendar_id IS DISTINCT FROM OLD.calendar_id THEN
      RAISE EXCEPTION 'Only the owner can move this event to a different calendar'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'folders' THEN
    IF NEW.parent_folder_id IS DISTINCT FROM OLD.parent_folder_id THEN
      RAISE EXCEPTION 'Only the owner can move this folder'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ownership_tasks ON public.tasks;
CREATE TRIGGER guard_ownership_tasks
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();

DROP TRIGGER IF EXISTS guard_ownership_notes ON public.notes;
CREATE TRIGGER guard_ownership_notes
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();

DROP TRIGGER IF EXISTS guard_ownership_lists ON public.lists;
CREATE TRIGGER guard_ownership_lists
  BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();

DROP TRIGGER IF EXISTS guard_ownership_events ON public.events;
CREATE TRIGGER guard_ownership_events
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();

DROP TRIGGER IF EXISTS guard_ownership_folders ON public.folders;
CREATE TRIGGER guard_ownership_folders
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();

DROP TRIGGER IF EXISTS guard_ownership_calendars ON public.calendars;
CREATE TRIGGER guard_ownership_calendars
  BEFORE UPDATE ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_columns();
