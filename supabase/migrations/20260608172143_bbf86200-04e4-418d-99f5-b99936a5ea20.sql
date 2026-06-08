
-- 1. Explicit deny-all to authenticated for server-only tables (documents intent; service_role bypasses RLS)
CREATE POLICY "Server-only access" ON public.ms_oauth_tokens
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Server-only access" ON public.ms_subscriptions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 2. profiles INSERT: prevent privilege escalation via platform_role
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND platform_role = 'user'::platform_role);

-- 3. ai_usage: remove client write policies; writes happen via service role only
DROP POLICY IF EXISTS "ai_usage_own_insert" ON public.ai_usage;
DROP POLICY IF EXISTS "ai_usage_own_update" ON public.ai_usage;

-- 4. email_unsubscribe_tokens: explicit deny for client writes (created via SECURITY DEFINER fn)
CREATE POLICY "No client writes" ON public.email_unsubscribe_tokens
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No client updates" ON public.email_unsubscribe_tokens
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes" ON public.email_unsubscribe_tokens
  FOR DELETE TO authenticated USING (false);

-- 5. user_entitlement_overrides: explicit deny for client writes
CREATE POLICY "No client writes" ON public.user_entitlement_overrides
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No client updates" ON public.user_entitlement_overrides
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes" ON public.user_entitlement_overrides
  FOR DELETE TO authenticated USING (false);
