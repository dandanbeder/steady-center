
DROP TRIGGER IF EXISTS tasks_set_completed_at ON public.tasks;
CREATE TRIGGER tasks_set_completed_at
BEFORE UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.tasks_set_completed_at();
