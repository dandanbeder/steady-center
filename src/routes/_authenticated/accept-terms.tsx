import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { acceptTermsAndPrivacy } from "@/lib/consent.functions";

export const Route = createFileRoute("/_authenticated/accept-terms")({
  head: () => ({ meta: [{ title: "Confirm consent · Heartbeat" }] }),
  component: AcceptTermsPage,
});

function AcceptTermsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const accept = useServerFn(acceptTermsAndPrivacy);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const mut = useMutation({
    mutationFn: () => accept({ data: { marketing_opt_in: marketing } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding-profile"] });
      toast.success("Thanks, you're all set.");
      navigate({ to: "/today" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-8"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        <h1 className="text-2xl text-primary mb-2">One quick thing</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Before you continue, please confirm you've read and agree to our
          Terms of Service and Privacy Policy. Heartbeat is operated by
          FlightMed (PTY) Ltd, South Africa, and processes your data in
          line with POPIA.
        </p>

        <div className="space-y-4">
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span>
              I agree to the{" "}
              <a href="/terms" target="_blank" rel="noreferrer" className="text-accent hover:underline">Terms</a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" className="text-accent hover:underline">Privacy Policy</a>.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm cursor-pointer">
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

        <div className="mt-8 flex justify-end">
          <Button onClick={() => mut.mutate()} disabled={!agreed || mut.isPending}>
            {mut.isPending ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>
    </main>
  );
}
