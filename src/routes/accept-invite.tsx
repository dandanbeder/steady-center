import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { getInvitationByToken, requestAccess } from "@/lib/invitations.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";

const searchSchema = z.object({
  token: z.string().uuid().optional(),
});

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "You've been invited · Heartbeat" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = useSearch({ from: "/accept-invite" });
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const getInvite = useServerFn(getInvitationByToken);
  const request = useServerFn(requestAccess);
  const [status, setStatus] = useState<"idle" | "pending" | "already_member" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const inviteQuery = useQuery({
    queryKey: ["invitation-by-token", token],
    queryFn: () => getInvite({ data: { token: token! } }),
    enabled: !!token && !!user,
  });

  const mutation = useMutation({
    mutationFn: () => request({ data: { token: token! } }),
    onSuccess: (r) => {
      if (r.status === "already_member") {
        setStatus("already_member");
        toast.success("You're already a member");
        setTimeout(() => navigate({ to: "/today" }), 1000);
      } else {
        setStatus("pending");
        toast.success("Access requested");
      }
    },
    onError: (e) => {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Failed to request access");
    },
  });

  useEffect(() => {
    if (token) sessionStorage.setItem("pending_invite_token", token);
  }, [token]);

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
    return (
      <Shell>
        <h1 className="text-xl mb-2">You've been invited to Heartbeat</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign up or sign in with the email that received this invite. Once signed in,
          you'll be able to request access — the inviter will review and approve.
        </p>
        <Button asChild>
          <Link to="/login">Continue to sign up / sign in</Link>
        </Button>
      </Shell>
    );
  }

  const invite = inviteQuery.data;
  const businessName = invite?.business_name ?? "this account";

  if (status === "pending") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">Request sent</h1>
        <p className="text-sm text-muted-foreground mb-6">
          We've notified the owner of {businessName}. You'll get an email once you're approved.
        </p>
        <Button asChild variant="ghost"><Link to="/today">Go home</Link></Button>
      </Shell>
    );
  }

  if (status === "already_member") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">You're already in {businessName}</h1>
        <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">Couldn't request access</h1>
        <p className="text-sm text-muted-foreground mb-6">{errMsg}</p>
        <Button asChild variant="ghost"><Link to="/today">Go home</Link></Button>
      </Shell>
    );
  }

  if (inviteQuery.isLoading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading invitation…</p></Shell>;
  }

  if (!invite || invite.status !== "sent") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">Invitation unavailable</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This invitation is no longer active. Ask the sender to invite you again.
        </p>
        <Button asChild variant="ghost"><Link to="/today">Go home</Link></Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl mb-2">You've been invited to {businessName}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        You've been invited as <strong>{invite.proposed_role}</strong>. Request access
        and the inviter will approve.
      </p>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Sending…" : "Request access"}
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-background">
      <img src={heartbeatLogo} alt="Heartbeat" className="h-10 mb-10" />
      <div
        className="max-w-md w-full rounded-2xl border border-border bg-card p-8"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        {children}
      </div>
    </div>
  );
}
