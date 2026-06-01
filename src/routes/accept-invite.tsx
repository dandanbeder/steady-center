import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { acceptInvite } from "@/lib/memberships.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";

const searchSchema = z.object({
  token: z.string().uuid().optional(),
});

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Accept invite · Heartbeat" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = useSearch({ from: "/accept-invite" });
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const accept = useServerFn(acceptInvite);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const mutation = useMutation({
    mutationFn: () => accept({ data: { token: token! } }),
    onSuccess: () => {
      setStatus("ok");
      toast.success("Invite accepted");
      setTimeout(() => navigate({ to: "/today" }), 1200);
    },
    onError: (e) => {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Failed to accept invite");
    },
  });

  useEffect(() => {
    if (!loading && user && token && status === "idle") {
      mutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token]);

  if (!token) {
    return (
      <Shell>
        <h1 className="text-xl mb-2">Invalid invite link</h1>
        <p className="text-sm text-muted-foreground">This link is missing its token.</p>
      </Shell>
    );
  }

  if (loading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }

  if (!user) {
    const next = `/accept-invite?token=${token}`;
    return (
      <Shell>
        <h1 className="text-xl mb-2">You've been invited to Heartbeat</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign in or create an account with the email that received this invite, then we'll add you automatically.
        </p>
        <Button asChild>
          <Link to="/login" search={{ next } as any}>Continue to sign in</Link>
        </Button>
      </Shell>
    );
  }

  if (status === "ok") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">You're in!</h1>
        <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">Couldn't accept this invite</h1>
        <p className="text-sm text-muted-foreground mb-6">{errMsg}</p>
        <Button asChild variant="ghost"><Link to="/today">Go home</Link></Button>
      </Shell>
    );
  }

  return <Shell><p className="text-sm text-muted-foreground">Accepting invite…</p></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-background">
      <img src={heartbeatLogo} alt="Heartbeat" className="h-10 mb-10" />
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8" style={{ boxShadow: "var(--shadow-soft)" }}>
        {children}
      </div>
    </div>
  );
}
