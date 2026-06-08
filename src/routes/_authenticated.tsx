import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { getOnboardingProfile } from "@/lib/onboarding";

// Heavy component (voice capture, dialogs, server fns) — load after first paint.
const TalkButton = lazy(() =>
  import("@/components/talk-button").then((m) => ({ default: m.TalkButton })),
);

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
    staleTime: 5 * 60_000,
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        …
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;

  const mustChangePw =
    profileQ.data?.must_change_password && pathname !== "/reset-password";
  if (mustChangePw) return <Navigate to="/reset-password" />;

  // Only redirect once profile has loaded and confirms onboarding isn't done.
  // Don't block the shell on the profile fetch — render immediately, redirect later if needed.
  const needsOnboarding =
    profileQ.data && !profileQ.data.onboarding_completed_at && pathname !== "/onboarding";
  if (needsOnboarding) return <Navigate to="/onboarding" />;

  return (
    <AppShell>
      <Outlet />
      <Suspense fallback={null}>
        <TalkButton />
      </Suspense>
    </AppShell>
  );
}
