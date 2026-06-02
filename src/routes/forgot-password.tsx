import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/password.functions";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password · Heartbeat" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { user, loading } = useAuth();
  const submitFn = useServerFn(requestPasswordReset);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await submitFn({ data: { email } });
    } catch {
      // Swallow — message stays generic on purpose.
    } finally {
      setSent(true);
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
          <h2 className="text-2xl mb-2">Forgot your password?</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your email and we'll send you a link to set a new one.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                If an account exists for <strong>{email}</strong>, we've sent a
                reset link. Check your inbox (and spam folder).
              </div>
              <Link
                to="/login"
                className="block text-sm text-center text-muted-foreground hover:text-accent"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Sending…" : "Send reset link"}
              </Button>
              <Link
                to="/login"
                className="block text-sm text-center text-muted-foreground hover:text-accent"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
