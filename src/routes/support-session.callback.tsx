import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLocalSupportSession } from "@/lib/support-session.client";

export const Route = createFileRoute("/support-session/callback")({
  component: SupportSessionCallback,
});

function SupportSessionCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Opening support session…");

  useEffect(() => {
    let cancelled = false;
    const finish = async () => {
      const support = getLocalSupportSession();
      if (!support) {
        setMessage("Support session state is missing. Return to Super Admin and start again.");
        return;
      }

      for (let i = 0; i < 20; i += 1) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session?.user.id === support.target_user_id) {
          await navigate({ to: "/today", replace: true });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      setMessage("Could not switch into the target account. End the support session and try again.");
    };
    finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 text-center text-muted-foreground">
      {message}
    </div>
  );
}