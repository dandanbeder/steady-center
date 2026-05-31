
-- profiles.timezone
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Johannesburg';

-- tasks.completed_at (already added in prior migration, keep idempotent)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- weekly_reports.narrative -> jsonb
ALTER TABLE public.weekly_reports
  ALTER COLUMN narrative DROP DEFAULT;

ALTER TABLE public.weekly_reports
  ALTER COLUMN narrative TYPE jsonb USING (
    CASE
      WHEN narrative IS NULL OR narrative = '' THEN '{}'::jsonb
      WHEN jsonb_typeof(to_jsonb(narrative)) = 'string' AND left(narrative,1) IN ('{','[')
        THEN narrative::jsonb
      ELSE jsonb_build_object('headline', '', 'wins', '[]'::jsonb, 'slipped', '[]'::jsonb, 'at_risk', '[]'::jsonb, 'suggestions', '[]'::jsonb, 'legacy_text', narrative)
    END
  );

ALTER TABLE public.weekly_reports
  ALTER COLUMN narrative SET DEFAULT '{}'::jsonb,
  ALTER COLUMN narrative SET NOT NULL;

-- RLS sanity (no-op if already enabled)
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
