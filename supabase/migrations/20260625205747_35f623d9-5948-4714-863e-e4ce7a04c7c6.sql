-- 1. task_attachments table
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_attachments_task_id_idx ON public.task_attachments(task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
CREATE POLICY task_attachments_select ON public.task_attachments
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'task', task_id, 'viewer') OR public.is_platform_admin());

DROP POLICY IF EXISTS task_attachments_insert ON public.task_attachments;
CREATE POLICY task_attachments_insert ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_access(auth.uid(), 'task', task_id, 'editor')
  );

DROP POLICY IF EXISTS task_attachments_update ON public.task_attachments;
CREATE POLICY task_attachments_update ON public.task_attachments
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'task', task_id, 'editor'))
  WITH CHECK (public.can_access(auth.uid(), 'task', task_id, 'editor'));

DROP POLICY IF EXISTS task_attachments_delete ON public.task_attachments;
CREATE POLICY task_attachments_delete ON public.task_attachments
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'task', task_id, 'editor'));

-- 2. Storage RLS on the private task-attachments bucket.
-- Path format: {task_id}/{uuid}-{filename}. First folder segment is the task_id.
-- Access is checked via can_access on the task itself, so the file inherits the
-- task's privacy: a private task -> only the owner; a shared task -> only people
-- with access to that task. Enforced at the file-access request, not in the UI.
DROP POLICY IF EXISTS task_attachments_storage_select ON storage.objects;
CREATE POLICY task_attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND public.can_access(auth.uid(), 'task', ((storage.foldername(name))[1])::uuid, 'viewer')
  );

DROP POLICY IF EXISTS task_attachments_storage_insert ON storage.objects;
CREATE POLICY task_attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND public.can_access(auth.uid(), 'task', ((storage.foldername(name))[1])::uuid, 'editor')
  );

DROP POLICY IF EXISTS task_attachments_storage_update ON storage.objects;
CREATE POLICY task_attachments_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND public.can_access(auth.uid(), 'task', ((storage.foldername(name))[1])::uuid, 'editor')
  );

DROP POLICY IF EXISTS task_attachments_storage_delete ON storage.objects;
CREATE POLICY task_attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND public.can_access(auth.uid(), 'task', ((storage.foldername(name))[1])::uuid, 'editor')
  );