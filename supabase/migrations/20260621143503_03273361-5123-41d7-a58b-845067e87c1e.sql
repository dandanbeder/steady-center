
-- ============ profiles enforcement fields ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS throttle_level text NOT NULL DEFAULT 'none'
    CHECK (throttle_level IN ('none','tight')),
  ADD COLUMN IF NOT EXISTS throttle_reason text,
  ADD COLUMN IF NOT EXISTS throttle_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS throttle_set_by uuid,
  ADD COLUMN IF NOT EXISTS last_warned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_warning_message text,
  ADD COLUMN IF NOT EXISTS warned_by uuid,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_by uuid,
  ADD COLUMN IF NOT EXISTS terminated_reason text;

-- ============ abuse_flags ============
CREATE TABLE IF NOT EXISTS public.abuse_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','dismissed','actioned')),
  severity text NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low','medium','high')),
  source text NOT NULL DEFAULT 'auto'
    CHECK (source IN ('auto','manual')),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  resolution_note text,
  resolution_action text
);

CREATE INDEX IF NOT EXISTS abuse_flags_user_idx ON public.abuse_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS abuse_flags_status_idx ON public.abuse_flags(status, created_at DESC);
-- Dedupe: at most one OPEN flag per user (auto scanner upgrades it instead of duplicating)
CREATE UNIQUE INDEX IF NOT EXISTS abuse_flags_one_open_per_user
  ON public.abuse_flags(user_id) WHERE status = 'open';

GRANT SELECT ON public.abuse_flags TO authenticated;
GRANT ALL ON public.abuse_flags TO service_role;
ALTER TABLE public.abuse_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins read abuse_flags"
  ON public.abuse_flags FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ============ abuse_thresholds (single-row config) ============
CREATE TABLE IF NOT EXISTS public.abuse_thresholds (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),  -- enforces singleton
  cap_hits_24h_high integer NOT NULL DEFAULT 50,
  cap_hits_24h_medium integer NOT NULL DEFAULT 20,
  distinct_ips_7d_high integer NOT NULL DEFAULT 8,
  distinct_ips_7d_medium integer NOT NULL DEFAULT 5,
  credit_burn_24h_high integer NOT NULL DEFAULT 5000,
  credit_burn_24h_medium integer NOT NULL DEFAULT 2000,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.abuse_thresholds (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.abuse_thresholds TO authenticated;
GRANT ALL ON public.abuse_thresholds TO service_role;
ALTER TABLE public.abuse_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins read abuse_thresholds"
  ON public.abuse_thresholds FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ============ scanner function ============
-- Auto-FLAGS (never punishes) users crossing thresholds. Idempotent: if an open
-- flag already exists for a user, it accumulates new signals into that row.
CREATE OR REPLACE FUNCTION public.admin_scan_abuse_signals()
RETURNS TABLE(user_id uuid, severity text, signals jsonb, evidence_summary text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.abuse_thresholds%ROWTYPE;
  rec record;
  sigs jsonb;
  sev text;
  evidence text;
  cap_hits int;
  ip_count int;
  burn int;
  existing_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO cfg FROM public.abuse_thresholds WHERE id = true;
  IF cfg IS NULL OR cfg.enabled = false THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.status = 'active'
      AND COALESCE(p.is_protected_primary, false) = false
  LOOP
    sigs := '[]'::jsonb;
    sev  := NULL;

    -- Signal 1: cap hits in last 24h
    SELECT COUNT(*) INTO cap_hits
      FROM public.ai_cap_hits
      WHERE ai_cap_hits.user_id = rec.id
        AND created_at > now() - interval '24 hours';
    IF cap_hits >= cfg.cap_hits_24h_high THEN
      sigs := sigs || jsonb_build_object('kind','cap_hits_24h','observed',cap_hits,'threshold',cfg.cap_hits_24h_high,'severity','high');
      sev := 'high';
    ELSIF cap_hits >= cfg.cap_hits_24h_medium THEN
      sigs := sigs || jsonb_build_object('kind','cap_hits_24h','observed',cap_hits,'threshold',cfg.cap_hits_24h_medium,'severity','medium');
      sev := COALESCE(sev,'medium');
    END IF;

    -- Signal 2: distinct IPs in last 7d
    SELECT COUNT(DISTINCT ip) INTO ip_count
      FROM public.login_history
      WHERE login_history.user_id = rec.id
        AND occurred_at > now() - interval '7 days'
        AND ip IS NOT NULL;
    IF ip_count >= cfg.distinct_ips_7d_high THEN
      sigs := sigs || jsonb_build_object('kind','distinct_ips_7d','observed',ip_count,'threshold',cfg.distinct_ips_7d_high,'severity','high');
      sev := 'high';
    ELSIF ip_count >= cfg.distinct_ips_7d_medium THEN
      sigs := sigs || jsonb_build_object('kind','distinct_ips_7d','observed',ip_count,'threshold',cfg.distinct_ips_7d_medium,'severity','medium');
      sev := COALESCE(sev,'medium');
    END IF;

    -- Signal 3: credit burn (purchased+allowance) in last 24h
    SELECT COALESCE(SUM(-delta), 0)::int INTO burn
      FROM public.credit_ledger
      WHERE credit_ledger.account_user_id = rec.id
        AND delta < 0
        AND source IN ('allowance','purchased')
        AND created_at > now() - interval '24 hours';
    IF burn >= cfg.credit_burn_24h_high THEN
      sigs := sigs || jsonb_build_object('kind','credit_burn_24h','observed',burn,'threshold',cfg.credit_burn_24h_high,'severity','high');
      sev := 'high';
    ELSIF burn >= cfg.credit_burn_24h_medium THEN
      sigs := sigs || jsonb_build_object('kind','credit_burn_24h','observed',burn,'threshold',cfg.credit_burn_24h_medium,'severity','medium');
      sev := COALESCE(sev,'medium');
    END IF;

    -- No signals? skip
    IF jsonb_array_length(sigs) = 0 THEN
      CONTINUE;
    END IF;

    evidence := format(
      'Auto-detected: cap_hits_24h=%s, distinct_ips_7d=%s, credit_burn_24h=%s',
      cap_hits, ip_count, burn
    );

    -- Upsert: keep one open flag per user, merge signals + bump severity
    SELECT f.id INTO existing_id FROM public.abuse_flags f
      WHERE f.user_id = rec.id AND f.status = 'open' LIMIT 1;
    IF existing_id IS NOT NULL THEN
      UPDATE public.abuse_flags
        SET signals = sigs,
            severity = CASE WHEN sev = 'high' THEN 'high' ELSE GREATEST(severity, sev) END,
            evidence_summary = evidence
        WHERE id = existing_id;
    ELSE
      INSERT INTO public.abuse_flags (user_id, source, severity, signals, evidence_summary)
        VALUES (rec.id, 'auto', COALESCE(sev,'low'), sigs, evidence);
    END IF;

    user_id := rec.id;
    severity := COALESCE(sev,'low');
    signals := sigs;
    evidence_summary := evidence;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_scan_abuse_signals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_scan_abuse_signals() TO authenticated;
