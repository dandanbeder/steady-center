import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://heartbeatcommand.software/" },
    ],
    links: [
      { rel: "canonical", href: "https://heartbeatcommand.software/" },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const { user, loading } = useAuth();

  // Per-user, server-side tutorial flag. Lives on profiles (RLS: each user
  // can only read/write their own row), so a returning user on a new
  // device/browser still goes straight to Today.
  const firstOpen = useQuery({
    queryKey: ["first-open-routing", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("has_seen_tutorial")
        .eq("id", user!.id)
        .maybeSingle();
      return { hasSeenTutorial: !!data?.has_seen_tutorial };
    },
  });

  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (firstOpen.isLoading) return null;

  // First genuine launch for this account → Tutorial. Every other plain
  // open of Heartbeat (web or installed PWA) → Today. Deep links bypass
  // this route entirely and resolve to their target.
  return <Navigate to={firstOpen.data?.hasSeenTutorial ? "/today" : "/learn"} />;
}
