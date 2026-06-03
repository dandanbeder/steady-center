import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, ShieldCheck, Trash2, KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  enrollTotp,
  getAuthAal,
  listLoginHistory,
  listMfaFactors,
  signOutOtherSessions,
  unenrollFactor,
  verifyTotpEnrollment,
} from "@/lib/security";
import { ChangePasswordSection } from "./change-password-section";

export function SecurityPanel() {
  const qc = useQueryClient();
  const factorsQ = useQuery({ queryKey: ["mfa-factors"], queryFn: listMfaFactors });
  const aalQ = useQuery({ queryKey: ["mfa-aal"], queryFn: getAuthAal });
  const historyQ = useQuery({ queryKey: ["login-history"], queryFn: () => listLoginHistory(20) });

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const startEnroll = useMutation({
    mutationFn: () => enrollTotp(),
    onSuccess: (d) => {
      setEnrollment({ id: d.id, qr: d.totp.qr_code, secret: d.totp.secret });
      setCode("");
      setEnrollOpen(true);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const confirmEnroll = useMutation({
    mutationFn: () => {
      if (!enrollment) throw new Error("No enrollment in progress");
      return verifyTotpEnrollment(enrollment.id, code.trim());
    },
    onSuccess: () => {
      toast.success("Two-factor enabled");
      setEnrollOpen(false);
      setEnrollment(null);
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
      qc.invalidateQueries({ queryKey: ["mfa-aal"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Code didn't match"),
  });

  const removeFactor = useMutation({
    mutationFn: (id: string) => unenrollFactor(id),
    onSuccess: () => {
      toast.success("Two-factor removed");
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
      qc.invalidateQueries({ queryKey: ["mfa-aal"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const revokeOthers = useMutation({
    mutationFn: () => signOutOtherSessions(),
    onSuccess: () => toast.success("Other sessions signed out"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Clean up enrollment if dialog closes without verification
  useEffect(() => {
    if (!enrollOpen && enrollment) {
      unenrollFactor(enrollment.id).catch(() => {});
      setEnrollment(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollOpen]);

  const totpFactors = factorsQ.data?.totp ?? [];
  const verified = totpFactors.filter((f) => f.status === "verified");

  return (
    <div className="space-y-10">
      <ChangePasswordSection />

      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Two-factor authentication
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Add a one-time code at sign-in using an authenticator app (1Password, Authy,
            Google Authenticator). Codes are verified server-side.
          </p>
        </header>

        {verified.length > 0 ? (
          <div className="space-y-2">
            {verified.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-2.5 text-sm min-w-0">
                  <ShieldCheck className="h-4 w-4 text-accent shrink-0" />
                  <span className="truncate">{f.friendly_name ?? "Authenticator"}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    · Added {new Date(f.created_at).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this two-factor method"
                  onClick={() => {
                    if (confirm("Remove this two-factor method?")) removeFactor.mutate(f.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Current assurance level:{" "}
              <span className="font-mono">{aalQ.data?.currentLevel ?? "—"}</span>
            </p>
          </div>
        ) : (
          <Button onClick={() => startEnroll.mutate()} disabled={startEnroll.isPending}>
            <KeyRound className="h-4 w-4 mr-2" />
            {startEnroll.isPending ? "Preparing…" : "Enable two-factor"}
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <LogOut className="h-4 w-4" />
            Active sessions
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Sign out everywhere else. This device stays signed in.
          </p>
        </header>
        <Button
          variant="outline"
          onClick={() => revokeOthers.mutate()}
          disabled={revokeOthers.isPending}
        >
          {revokeOthers.isPending ? "Signing out…" : "Sign out other sessions"}
        </Button>
      </section>

      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold">Login history</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Recent sign-in events on your account.
          </p>
        </header>
        {historyQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (historyQ.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No recent sign-in events yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {historyQ.data!.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="capitalize">{e.event.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-md">
                    {e.user_agent ?? "Unknown device"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up your authenticator</DialogTitle>
            <DialogDescription>
              Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
            </DialogDescription>
          </DialogHeader>
          {enrollment && (
            <div className="space-y-3">
              <div className="flex justify-center bg-white p-4 rounded-lg">
                {/* qr_code is an SVG data URI from Supabase */}
                <img src={enrollment.qr} alt="Authenticator QR code" className="h-48 w-48" />
              </div>
              <p className="text-xs text-muted-foreground break-all">
                Or type this secret: <span className="font-mono">{enrollment.secret}</span>
              </p>
              <Input
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnrollOpen(false)} disabled={confirmEnroll.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => confirmEnroll.mutate()}
              disabled={code.trim().length < 6 || confirmEnroll.isPending}
            >
              {confirmEnroll.isPending ? "Verifying…" : "Verify & enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
