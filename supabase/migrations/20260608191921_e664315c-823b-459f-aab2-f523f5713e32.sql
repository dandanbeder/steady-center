CREATE OR REPLACE FUNCTION public.login_history_block_modify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'login_history is append-only';
END;
$function$;

DROP TRIGGER IF EXISTS login_history_no_update ON public.login_history;
DROP TRIGGER IF EXISTS login_history_no_delete ON public.login_history;

CREATE TRIGGER login_history_no_update
  BEFORE UPDATE ON public.login_history
  FOR EACH ROW EXECUTE FUNCTION public.login_history_block_modify();

CREATE TRIGGER login_history_no_delete
  BEFORE DELETE ON public.login_history
  FOR EACH ROW EXECUTE FUNCTION public.login_history_block_modify();