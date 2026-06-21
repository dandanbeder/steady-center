ALTER TABLE public.ai_prefs ADD COLUMN IF NOT EXISTS coach_style text NOT NULL DEFAULT 'warm';
ALTER TABLE public.ai_prefs DROP CONSTRAINT IF EXISTS ai_prefs_coach_style_check;
ALTER TABLE public.ai_prefs ADD CONSTRAINT ai_prefs_coach_style_check CHECK (coach_style IN ('warm', 'direct', 'off'));