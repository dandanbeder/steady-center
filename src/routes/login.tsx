import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { sendWelcomeAndNotifyAdmins } from "@/lib/onboarding.functions";
import { detectTimezone } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Heartbeat" }] }),
  component: LoginPage,
});

// A small, curated list — covers the common cases without being overwhelming.
const TIMEZONES = [
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

const HEAR_OPTIONS = [
  "A friend or colleague",
  "Search engine",
  "Social media",
  "Podcast or newsletter",
  "Conference or event",
  "Other",
];

function LoginPage() {
  const { user, loading } = useAuth();
  const sendWelcome = useServerFn(sendWelcomeAndNotifyAdmins);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // signup-only
  const [fullName, setFullName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [hearAbout, setHearAbout] = useState("");
  const detected = useMemo(() => detectTimezone(), []);
  const [timezone, setTimezone] = useState(detected);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);

  if (!loading && user) return <Navigate to="/" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (!agreed) {
          toast.error("Please accept the Terms and Privacy Policy to continue.");
          setBusy(false);
          return;
        }
        const nowIso = new Date().toISOString();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: fullName,
              organisation: organisation || null,
              role_title: roleTitle || null,
              phone: phone || null,
              hear_about_us: hearAbout || null,
              timezone,
              terms_accepted_at: nowIso,
              marketing_opt_in: marketing,
            },
          },
        });
        if (error) throw error;
        sendWelcome({ data: { email, full_name: fullName } }).catch((e) =>
          console.error("welcome email failed", e),
        );
        toast.success("Check your email to confirm your account.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <img src={heartbeatLogo} alt="Heartbeat" className="h-16 w-auto" />
          <p className="mt-3 text-foreground">Organize your world. Move with purpose.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace for your businesses, studies, projects, tasks, notes, meetings, and daily priorities.
          </p>
        </div>

        <div
          className="rounded-2xl border border-border bg-card p-8"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          <h2 className="text-2xl mb-6">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h2>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={320}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-accent"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "signup" ? 8 : 6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              )}
            </div>

            {mode === "signup" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="org">
                      Organisation <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="org"
                      value={organisation}
                      onChange={(e) => setOrganisation(e.target.value)}
                      maxLength={200}
                      autoComplete="organization"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">
                      Role / title <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="role"
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      maxLength={120}
                      autoComplete="organization-title"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">
                    Phone <span className="text-muted-foreground">(optional, for SMS reminders)</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={32}
                    placeholder="+27 82 123 4567"
                    autoComplete="tel"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tz">Your timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger id="tz"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!TIMEZONES.includes(detected) && (
                        <SelectItem value={detected}>{detected} (detected)</SelectItem>
                      )}
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                          {tz === detected ? " (detected)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hear">
                    How did you hear about us? <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Select value={hearAbout} onValueChange={setHearAbout}>
                    <SelectTrigger id="hear">
                      <SelectValue placeholder="Pick one" />
                    </SelectTrigger>
                    <SelectContent>
                      {HEAR_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 pt-1">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={agreed}
                      onCheckedChange={(v) => setAgreed(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      I agree to the{" "}
                      <a href="/terms" target="_blank" className="text-accent hover:underline">
                        Terms
                      </a>{" "}
                      and{" "}
                      <a href="/privacy" target="_blank" className="text-accent hover:underline">
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={marketing}
                      onCheckedChange={(v) => setMarketing(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-muted-foreground">
                      Send me occasional product updates. No spam, unsubscribe any time.
                    </span>
                  </label>
                </div>
              </>
            )}

            <Button
              type="submit"
              disabled={busy || (mode === "signup" && !agreed)}
              className="w-full"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: window.location.origin,
                });
                if (result.error) throw new Error(result.error.message ?? "Google sign-in failed");
                if (result.redirected) return;
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Google sign-in failed");
                setBusy(false);
              }
            }}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
            </svg>
            Continue with Google
          </Button>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 text-sm text-muted-foreground hover:text-accent w-full text-center"
          >
            {mode === "signin"
              ? "No account yet? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} FlightMed (PTY) Ltd. All rights reserved.
          <span className="mx-2 opacity-50">·</span>
          <a href="/terms" className="hover:text-foreground">Terms</a>
          <span className="mx-2 opacity-50">·</span>
          <a href="/privacy" className="hover:text-foreground">Privacy</a>
        </p>
      </div>
    </div>
  );
}
