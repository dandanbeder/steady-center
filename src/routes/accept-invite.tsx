import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { acceptInvitation, getInvitationByToken } from "@/lib/invitations.functions";
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
  const qc = useQueryClient();
  const getInvite = useServerFn(getInvitationByToken);
  const accept = useServerFn(acceptInvitation);
  const [status, setStatus] = useState<"idle" | "joined" | "already_member" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const inviteQuery = useQuery({
    queryKey: ["invitation-by-token", token],
    queryFn: () => getInvite({ data: { token: token! } }),
    enabled: !!token && !!user,
  });

  const mutation = useMutation({
    mutationFn: () => accept({ data: { token: token! } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
      qc.invalidateQueries({ queryKey: ["memberships"] });
      if (r.status === "already_member") {
        setStatus("already_member");
        toast.success("You're already a member");
      } else {
        setStatus("joined");
        toast.success("Welcome to the team");
      }
      setTimeout(() => navigate({ to: "/today" }), 1200);
    },
    onError: (e) => {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Failed to accept invite");
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
          Sign in (or sign up) with the email this invite was sent to. Once you're signed
          in we'll add you to the team, your own private space stays yours.
        </p>
        <Button asChild>
          <Link to="/login">Continue to sign up / sign in</Link>
        </Button>
      </Shell>
    );
  }

  const invite = inviteQuery.data;
  const businessName = invite?.business_name ?? "this team";

  if (status === "joined") {
    return (
      <Shell>
        <h1 className="text-xl mb-2">You're in 🎉</h1>
        <p className="text-sm text-muted-foreground">Taking you to {businessName}…</p>
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
        <h1 className="text-xl mb-2">Couldn't accept invite</h1>
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
          This invitation has been revoked, used, or expired. Ask the sender to invite you again.
        </p>
        <Button asChild variant="ghost"><Link to="/today">Go home</Link></Button>
      </Shell>
    );
  }

  const wrongEmail =
    user.email && invite.invited_email &&
    user.email.toLowerCase() !== invite.invited_email.toLowerCase();

  return (
    <Shell>
      <h1 className="text-xl mb-2">You've been invited to {businessName}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Join as <strong>{invite.proposed_role}</strong>. Your own private space stays
        private, joining a team never shares your personal work.
      </p>
      {wrongEmail ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm mb-4">
          This invite was sent to <strong>{invite.invited_email}</strong>, but you're
          signed in as <strong>{user.email}</strong>. Sign in with the invited address
          to accept.
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !!wrongEmail}>
          {mutation.isPending ? "Joining…" : `Accept invite & join as ${invite.proposed_role}`}
        </Button>
        <Button asChild variant="ghost"><Link to="/today">Not now</Link></Button>
      </div>
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
