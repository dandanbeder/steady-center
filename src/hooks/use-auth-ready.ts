import { useAuth } from "@/hooks/use-auth";

/**
 * Gate Supabase queries on a fully-restored session. Prevents the
 * "query fires before session is ready → RLS sees anon → empty/permission
 * error → React Query retry/flicker → 'Try Again'" race condition.
 *
 * Use as: `useQuery({ ..., enabled: isReady && !!user })`
 */
export function useAuthReady() {
  const { user, session, loading } = useAuth();
  const isReady = !loading;
  // A session that has an access_token is what RLS actually needs.
  const hasSession = !!session?.access_token;
  return { user, isReady, hasSession, ready: isReady && hasSession };
}
