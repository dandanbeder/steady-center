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

  const landing = useQuery({
    queryKey: ["default-landing", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("default_landing")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.default_landing as "today" | "calendar") ?? "today";
    },
  });

  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (landing.isLoading) return null;
  return <Navigate to={landing.data === "calendar" ? "/calendar" : "/today"} />;
}
