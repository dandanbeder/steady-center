
-- Add keep_recording flag on meetings (default: don't retain audio)
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS keep_recording boolean NOT NULL DEFAULT false;

-- Add ON DELETE CASCADE foreign keys so deleting a business removes child data.
-- Use DO blocks to be idempotent.

DO $$ BEGIN
  ALTER TABLE public.calendars
    ADD CONSTRAINT calendars_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_calendar_id_fkey
    FOREIGN KEY (calendar_id) REFERENCES public.calendars(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.folders
    ADD CONSTRAINT folders_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.lists
    ADD CONSTRAINT lists_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notes
    ADD CONSTRAINT notes_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notes
    ADD CONSTRAINT notes_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.action_items
    ADD CONSTRAINT action_items_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.action_items
    ADD CONSTRAINT action_items_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.weekly_reports
    ADD CONSTRAINT weekly_reports_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
