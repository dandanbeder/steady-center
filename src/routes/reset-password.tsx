import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set a new password · Heartbeat" }] }),
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid" | "done";

function passwordIssues(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return "Must include a letter and a number";
  return null;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase's recovery link redirects with tokens in the URL hash and the
    // client picks them up automatically. Wait for a session, then declare
    // the page ready.
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setStatus("ready");
        return;
      }
      // Give the URL-hash exchange a moment.
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        if (cancelled) return;
        if (s) setStatus("ready");
      });
      setTimeout(() => {
        if (cancelled) return;
        supabase.auth.getSession().then(({ data: d }) => {
          if (!d.session) setStatus("invalid");
        });
      }, 1500);
      return () => sub.subscription.unsubscribe();
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const issue = password ? passwordIssues(password) : null;
  const mismatch = confirm && password !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (issue || mismatch) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      toast.success("Password updated");
      setTimeout(() => navigate({ to: "/" }), 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <img src={heartbeatLogo} alt="Heartbeat" className="h-16 w-auto" />
        </div>
        <div
          className="rounded-2xl border border-border bg-card p-8"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          {status === "checking" && (
            <p className="text-sm text-muted-foreground">Checking your link…</p>
          )}

          {status === "invalid" && (
            <div className="space-y-4">
              <h2 className="text-2xl">This link has expired</h2>
              <p className="text-sm text-muted-foreground">
                Reset links are valid for one hour and can only be used once.
                Request a fresh one to continue.
              </p>
              <Link to="/forgot-password">
                <Button className="w-full">Request a new link</Button>
              </Link>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-3">
              <h2 className="text-2xl">Password updated</h2>
              <p className="text-sm text-muted-foreground">
                You're signed in. Taking you to your dashboard…
              </p>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="text-2xl mb-1">Set a new password</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Pick something memorable but strong.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                />
                {issue && (
                  <p className="text-xs text-destructive">{issue}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cf">Confirm new password</Label>
                <Input
                  id="cf"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                {mismatch && (
                  <p className="text-xs text-destructive">
                    Passwords don't match
                  </p>
                )}
              </div>
              <Button
                type="submit"
                disabled={busy || !!issue || !!mismatch || !password || !confirm}
                className="w-full"
              >
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
