import { createStart, createMiddleware } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { renderErrorPage } from "./lib/error-page";

/**
 * Adds defence-in-depth HTTP security headers to every response. The edge
 * already enforces HTTPS, but HSTS pins it; the rest reduce clickjacking,
 * MIME-sniffing, and referrer leakage. CSP is intentionally not set yet —
 * the app uses inline scripts via TanStack's <Scripts/> shell.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Block powerful browser features the app doesn't use; allow microphone
  // on first-party only (voice capture).
  "Permissions-Policy":
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
};

function applySecurityHeaders(res: Response): Response {
  // Don't clobber explicit overrides set by a handler (e.g. a route that
  // wants to be embeddable — none today, but be defensive).
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    const res = await next();
    if (res instanceof Response) return applySecurityHeaders(res);
    return res;
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return applySecurityHeaders(
      new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
