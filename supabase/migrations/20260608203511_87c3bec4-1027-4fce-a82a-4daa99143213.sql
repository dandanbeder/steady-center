
-- 1. Table
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Superadmins only can read
CREATE POLICY "Superadmins read analytics_events"
  ON public.analytics_events FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- No client writes; triggers run as definer, service_role bypasses RLS.
-- (No INSERT/UPDATE/DELETE policy ⇒ blocked for authenticated users.)

CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created
  ON public.analytics_events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user
  ON public.analytics_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_account
  ON public.analytics_events (account_id, created_at DESC);

-- 2. Generic logger (SECURITY DEFINER so triggers can bypass RLS)
CREATE OR REPLACE FUNCTION public.log_analytics_event(
  p_type text,
  p_user_id uuid,
  p_account_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.analytics_events (user_id, account_id, type, metadata)
  VALUES (p_user_id, p_account_id, p_type, COALESCE(p_metadata, '{}'::jsonb));
END $$;

REVOKE EXECUTE ON FUNCTION public.log_analytics_event(text, uuid, uuid, jsonb) FROM anon, authenticated, PUBLIC;

-- 3. Trigger functions

-- signup → profiles INSERT
CREATE OR REPLACE FUNCTION public.tg_log_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_analytics_event('signup', NEW.id, NULL, '{}'::jsonb);
  RETURN NEW;
END $$;

-- login → login_history INSERT (only successful logins)
CREATE OR REPLACE FUNCTION public.tg_log_login()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.event IN ('login','login_success','signed_in') THEN
    PERFORM public.log_analytics_event('login', NEW.user_id, NULL,
      jsonb_build_object('event', NEW.event));
  END IF;
  RETURN NEW;
END $$;

-- account_created → businesses INSERT
CREATE OR REPLACE FUNCTION public.tg_log_account_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_analytics_event('account_created', NEW.owner_id, NEW.id, '{}'::jsonb);
  RETURN NEW;
END $$;

-- calendar_connected → calendars INSERT (only real providers)
CREATE OR REPLACE FUNCTION public.tg_log_calendar_connected()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.provider IS NOT NULL AND NEW.provider <> 'manual' THEN
    PERFORM public.log_analytics_event('calendar_connected', NEW.owner_id, NEW.business_id,
      jsonb_build_object('provider', NEW.provider));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_log_task_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_analytics_event('task_created', NEW.owner_id, NEW.business_id, '{}'::jsonb);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_log_note_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_analytics_event('note_created', NEW.owner_id, NEW.business_id,
    jsonb_build_object('note_type', NEW.note_type));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_log_meeting_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_analytics_event('meeting_created', NEW.owner_id, NEW.business_id, '{}'::jsonb);
  RETURN NEW;
END $$;

-- ai_action_used → ai_usage INSERT (one row per month per user; we log on increment too)
CREATE OR REPLACE FUNCTION public.tg_log_ai_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.actions, 0);
  ELSE
    delta := COALESCE(NEW.actions, 0) - COALESCE(OLD.actions, 0);
  END IF;
  IF delta > 0 THEN
    PERFORM public.log_analytics_event('ai_action_used', NEW.user_id, NULL,
      jsonb_build_object('delta', delta, 'month', NEW.month));
  END IF;
  RETURN NEW;
END $$;

-- Subscription lifecycle (plan_changed, trial_started, trial_converted, subscription_canceled, payment_failed)
CREATE OR REPLACE FUNCTION public.tg_log_subscription_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  acct uuid := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'trialing' THEN
      PERFORM public.log_analytics_event('trial_started', NEW.user_id, NULL,
        jsonb_build_object('product_id', NEW.product_id, 'trial_end', NEW.trial_end));
    END IF;
    PERFORM public.log_analytics_event('plan_changed', NEW.user_id, NULL,
      jsonb_build_object('product_id', NEW.product_id, 'status', NEW.status,
                         'quantity', NEW.quantity, 'billing_cycle', NEW.billing_cycle));
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = 'trialing' AND NEW.status = 'active' THEN
    PERFORM public.log_analytics_event('trial_converted', NEW.user_id, NULL,
      jsonb_build_object('product_id', NEW.product_id));
  END IF;

  IF NEW.status = 'canceled' AND OLD.status IS DISTINCT FROM 'canceled' THEN
    PERFORM public.log_analytics_event('subscription_canceled', NEW.user_id, NULL,
      jsonb_build_object('product_id', NEW.product_id, 'cancel_at_period_end', NEW.cancel_at_period_end));
  END IF;

  IF NEW.status = 'past_due' AND OLD.status IS DISTINCT FROM 'past_due' THEN
    PERFORM public.log_analytics_event('payment_failed', NEW.user_id, NULL,
      jsonb_build_object('product_id', NEW.product_id));
  END IF;

  IF (OLD.product_id IS DISTINCT FROM NEW.product_id)
     OR (OLD.quantity IS DISTINCT FROM NEW.quantity)
     OR (OLD.billing_cycle IS DISTINCT FROM NEW.billing_cycle) THEN
    PERFORM public.log_analytics_event('plan_changed', NEW.user_id, NULL,
      jsonb_build_object('product_id', NEW.product_id, 'status', NEW.status,
                         'quantity', NEW.quantity, 'billing_cycle', NEW.billing_cycle,
                         'prev_product_id', OLD.product_id, 'prev_quantity', OLD.quantity,
                         'prev_billing_cycle', OLD.billing_cycle));
  END IF;

  RETURN NEW;
END $$;

-- 4. Triggers
DROP TRIGGER IF EXISTS tg_analytics_signup ON public.profiles;
CREATE TRIGGER tg_analytics_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_signup();

DROP TRIGGER IF EXISTS tg_analytics_login ON public.login_history;
CREATE TRIGGER tg_analytics_login
  AFTER INSERT ON public.login_history
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_login();

DROP TRIGGER IF EXISTS tg_analytics_account_created ON public.businesses;
CREATE TRIGGER tg_analytics_account_created
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_account_created();

DROP TRIGGER IF EXISTS tg_analytics_calendar_connected ON public.calendars;
CREATE TRIGGER tg_analytics_calendar_connected
  AFTER INSERT ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_calendar_connected();

DROP TRIGGER IF EXISTS tg_analytics_task_created ON public.tasks;
CREATE TRIGGER tg_analytics_task_created
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_task_created();

DROP TRIGGER IF EXISTS tg_analytics_note_created ON public.notes;
CREATE TRIGGER tg_analytics_note_created
  AFTER INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_note_created();

DROP TRIGGER IF EXISTS tg_analytics_meeting_created ON public.meetings;
CREATE TRIGGER tg_analytics_meeting_created
  AFTER INSERT ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_meeting_created();

DROP TRIGGER IF EXISTS tg_analytics_ai_action ON public.ai_usage;
CREATE TRIGGER tg_analytics_ai_action
  AFTER INSERT OR UPDATE ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_ai_action();

DROP TRIGGER IF EXISTS tg_analytics_subscription_lifecycle ON public.subscriptions;
CREATE TRIGGER tg_analytics_subscription_lifecycle
  AFTER INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_subscription_lifecycle();
