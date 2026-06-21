GRANT SELECT, INSERT, UPDATE ON public.journal_access_grants TO authenticated;
GRANT ALL ON public.journal_access_grants TO service_role;

GRANT SELECT, INSERT ON public.journal_access_log TO authenticated;
GRANT ALL ON public.journal_access_log TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_meta TO authenticated;
GRANT ALL ON public.journal_meta TO service_role;

GRANT SELECT ON public.team_audit_log TO authenticated;
GRANT ALL ON public.team_audit_log TO service_role;