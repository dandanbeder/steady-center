import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { completeMicrosoftOAuth } from "@/lib/microsoft-calendar.functions";

type Search = { code?: string; state?: string; error?: string; error_description?: string };

export const Route = createFileRoute("/auth/microsoft/callback")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    code: typeof s.code === "string" ? s.code : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
    error: typeof s.error === "string" ? s.error : undefined,
    error_description: typeof s.error_description === "string" ? s.error_description : undefined,
  }),
  component: MicrosoftCallback,
});

function MicrosoftCallback() {
  const { code, state, error, error_description } = useSearch({ from: Route.id });
  const completeFn = useServerFn(completeMicrosoftOAuth);
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    // Restrict postMessage to the same origin as the popup itself, the opener
    // must be on this origin for the message to be delivered, preventing
    // tab-napping / cross-origin leakage of OAuth completion signals.
    const targetOrigin = window.location.origin;
    async function run() {
      if (error) {
        const msg = error_description || error;
        setStatus("error");
        setMessage(msg);
        // Forward only a generic code; never leak provider error_description cross-window.
        try { window.opener?.postMessage({ type: "ms-oauth:error", error: "oauth_error" }, targetOrigin); } catch {}
        return;
      }
      if (!code || !state) {
        setStatus("error");
        setMessage("Missing code/state parameter");
        return;
      }
      try {
        await completeFn({ data: { code, state } });
        if (cancelled) return;
        setStatus("done");
        try { window.opener?.postMessage({ type: "ms-oauth:complete" }, targetOrigin); } catch {}
        // If this is a popup, close it; otherwise redirect to settings.
        setTimeout(() => {
          if (window.opener && !window.opener.closed) {
            window.close();
          } else {
            window.location.replace("/settings");
          }
        }, 600);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setMessage(msg);
        try { window.opener?.postMessage({ type: "ms-oauth:error", error: "oauth_error" }, targetOrigin); } catch {}
      }
    }
    run();
    return () => { cancelled = true; };
  }, [code, state, error, error_description, completeFn]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-3">
        {status === "working" && <p className="text-muted-foreground">Connecting Microsoft…</p>}
        {status === "done" && <p>Connected, you can close this window.</p>}
        {status === "error" && (
          <>
            <p className="text-destructive">Microsoft sign-in failed</p>
            <p className="text-sm text-muted-foreground break-words">{message}</p>
            <button
              onClick={() => window.close()}
              className="text-sm underline"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
