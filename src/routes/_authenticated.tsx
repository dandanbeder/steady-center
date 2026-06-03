import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { TalkButton } from "@/components/talk-button";
import { getOnboardingProfile } from "@/lib/onboarding";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const profileQ = useQuery({
    queryKey: ["onboarding-profile"],
    queryFn: getOnboardingProfile,
    enabled: !!user,
    staleTime: 60_000,
  });

  if (loading || (user && profileQ.isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        …
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;

  const needsOnboarding =
    profileQ.data && !profileQ.data.onboarding_completed_at && pathname !== "/onboarding";
  if (needsOnboarding) return <Navigate to="/onboarding" />;

  return (
    <AppShell>
      <Outlet />
      <TalkButton />
    </AppShell>
  );
}
