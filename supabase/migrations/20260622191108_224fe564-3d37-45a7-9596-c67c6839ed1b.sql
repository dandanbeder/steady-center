
CREATE TABLE public.meeting_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  text text NOT NULL,
  outcome_id uuid REFERENCES public.outcomes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_decisions TO authenticated;
GRANT ALL ON public.meeting_decisions TO service_role;

ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_decisions_owner_select ON public.meeting_decisions
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY meeting_decisions_owner_insert ON public.meeting_decisions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY meeting_decisions_owner_update ON public.meeting_decisions
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY meeting_decisions_owner_delete ON public.meeting_decisions
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_meeting_decisions_meeting ON public.meeting_decisions(meeting_id);
