CREATE INDEX IF NOT EXISTS idx_events_business_start ON public.events (business_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_owner_start ON public.events (owner_id, start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_business_status_due ON public.tasks (business_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_open_due ON public.tasks (due_at) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status_due ON public.tasks (owner_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_notes_business_updated ON public.notes (business_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memberships_user_business ON public.memberships (user_id, business_id);
CREATE INDEX IF NOT EXISTS idx_meetings_business_created ON public.meetings (business_id, created_at DESC);