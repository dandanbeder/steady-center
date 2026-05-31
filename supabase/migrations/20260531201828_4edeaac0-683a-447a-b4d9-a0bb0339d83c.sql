
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE public.task_priority AS ENUM ('urgent', 'high', 'normal', 'low');

CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#7A8471',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner select folders" ON public.folders FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert folders" ON public.folders FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update folders" ON public.folders FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete folders" ON public.folders FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX idx_folders_owner ON public.folders(owner_id);
CREATE INDEX idx_folders_business ON public.folders(business_id);

CREATE TABLE public.lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lists TO authenticated;
GRANT ALL ON public.lists TO service_role;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner select lists" ON public.lists FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert lists" ON public.lists FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update lists" ON public.lists FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete lists" ON public.lists FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX idx_lists_owner ON public.lists(owner_id);
CREATE INDEX idx_lists_folder ON public.lists(folder_id);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.task_priority NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner select tasks" ON public.tasks FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert tasks" ON public.tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update tasks" ON public.tasks FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete tasks" ON public.tasks FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX idx_tasks_owner ON public.tasks(owner_id);
CREATE INDEX idx_tasks_list ON public.tasks(list_id);
CREATE INDEX idx_tasks_business ON public.tasks(business_id);
CREATE INDEX idx_tasks_parent ON public.tasks(parent_task_id);
CREATE INDEX idx_tasks_due ON public.tasks(due_at);
