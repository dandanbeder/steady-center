import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/use-auth";
import { ActiveBusinessProvider } from "@/hooks/use-active-business";
import { Toaster } from "@/components/ui/sonner";
import { useAppearanceBoot } from "@/hooks/use-appearance-boot";
import { registerServiceWorker } from "@/lib/register-sw";

function AppearanceBoot() {
  useAppearanceBoot();
  return null;
}

function ServiceWorkerBoot() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl">404</h1>
        <h2 className="mt-4 text-xl text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  const detail = error?.message || String(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong.</p>
        {detail ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {detail}
          </pre>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={async () => {
              await router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "google-site-verification", content: "CaXsy9GwOCQZAzEfagnJ4B3rUdbd5Q7VWuL8wwccKXA" },
      { title: "Heartbeat, Calm command center for your businesses" },
      { name: "description", content: "Heartbeat brings calendars, tasks, notes and meetings for every business you run into one calm, focused workspace, so you can move with purpose without switching tools." },
      { name: "theme-color", content: "#26382F" },
      { property: "og:title", content: "Heartbeat, Manage every business in one calm workspace" },
      { name: "twitter:title", content: "Heartbeat, Manage every business in one calm workspace" },
      { property: "og:description", content: "Calendars, tasks, notes and meeting summaries for every business you run, together in a focused command center so your day stays clear." },
      { name: "twitter:description", content: "Calendars, tasks, notes and meeting summaries for every business you run, together in a focused command center so your day stays clear." },
      { property: "og:image", content: "https://heartbeatcommand.software/__l5e/assets-v1/5c4205a8-63e1-40dc-82bf-381716964d22/heartbeat-og.png" },
      { name: "twitter:image", content: "https://heartbeatcommand.software/__l5e/assets-v1/5c4205a8-63e1-40dc-82bf-381716964d22/heartbeat-og.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Heartbeat" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Heartbeat" },
      { name: "application-name", content: "Heartbeat" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "Heartbeat",
              url: "https://heartbeatcommand.software",
              logo: "https://heartbeatcommand.software/icon-512.png",
            },
            {
              "@type": "WebSite",
              name: "Heartbeat",
              url: "https://heartbeatcommand.software",
              description: "A calm command center for your businesses, calendars, tasks, notes and meetings in one place.",
            },
            {
              "@type": "SoftwareApplication",
              name: "Heartbeat",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              url: "https://heartbeatcommand.software",
              description: "A calm command center for your businesses, calendars, tasks, notes and meetings in one place.",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            },
          ],
        }),
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppearanceBoot />
        <ServiceWorkerBoot />
        <ActiveBusinessProvider>
          <Outlet />
          <Toaster />
        </ActiveBusinessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
