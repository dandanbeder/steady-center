import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBusiness, listBusinesses } from "@/lib/businesses";
import {
  completeOnboarding,
  getOnboardingProfile,
  saveWeeklyReview,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Welcome · Heartbeat" }] }),
  component: OnboardingPage,
});

const COLORS = ["#7A8471", "#5B7A6A", "#8B6F47", "#A8826A", "#6B8E9E", "#B47C7C"];
const DAYS = [
  { v: 1, label: "Monday" },
  { v: 2, label: "Tuesday" },
  { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" },
  { v: 5, label: "Friday" },
  { v: 6, label: "Saturday" },
  { v: 0, label: "Sunday" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const profileQ = useQuery({ queryKey: ["onboarding-profile"], queryFn: getOnboardingProfile });
  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  // Step 1 — account
  const [accountName, setAccountName] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  // Step 3 — weekly review
  const [reviewDay, setReviewDay] = useState<number>(5);
  const [reviewHour, setReviewHour] = useState<number>(16);
  const [reviewEnabled, setReviewEnabled] = useState(true);

  const createAccount = useMutation({
    mutationFn: () => createBusiness(accountName.trim(), color),
    onSuccess: () => {
      businessesQ.refetch();
      setStep(2);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create account"),
  });

  const saveReview = useMutation({
    mutationFn: () =>
      saveWeeklyReview({ day: reviewDay, hour: reviewHour, enabled: reviewEnabled }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const finish = useMutation({
    mutationFn: async () => {
      await saveReview.mutateAsync();
      await completeOnboarding();
    },
    onSuccess: () => {
      toast.success("You're all set");
      navigate({ to: "/today" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to finish"),
  });

  const hasAccount = (businessesQ.data?.length ?? 0) > 0;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>Welcome to Heartbeat</span>
          <button
            onClick={async () => {
              await completeOnboarding().catch(() => {});
              navigate({ to: "/today" });
            }}
            className="hover:text-foreground"
          >
            Skip for now
          </button>
        </div>

        <ol className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                n <= step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </ol>

        <div
          className="rounded-2xl border border-border bg-card p-8"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          {step === 1 && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Create your first Account</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Accounts let you keep different areas of work separate — each gets its own
                  color, calendars, and tasks. You can add more later.
                </p>
              </header>
              <div className="space-y-2">
                <Label htmlFor="account">Account name</Label>
                <Input
                  id="account"
                  placeholder="e.g. Personal, Acme Co, Side project"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Choose color ${c}`}
                      className={cn(
                        "h-8 w-8 rounded-full border-2 transition-all",
                        color === c ? "border-foreground scale-110" : "border-transparent",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => createAccount.mutate()}
                  disabled={!accountName.trim() || createAccount.isPending}
                >
                  {createAccount.isPending ? "Creating…" : "Continue"}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
              {hasAccount && (
                <p className="text-xs text-muted-foreground">
                  You already have an account set up — you can skip this step.{" "}
                  <button onClick={() => setStep(2)} className="text-accent hover:underline">
                    Continue
                  </button>
                </p>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Connect a calendar</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Sync Google or Microsoft Outlook so events flow into Heartbeat. You can do
                  this later from Settings.
                </p>
              </header>
              <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-3">
                <CalendarIcon className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Connect from Settings → Connections</p>
                  <p className="text-muted-foreground mt-1">
                    We&apos;ll keep your calendars in sync in the background.
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Connect calendars from <span className="font-medium">Settings → Connections</span> once you've finished onboarding.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Skip this step
                </Button>
                <Button onClick={() => setStep(3)}>
                  Continue
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Your weekly review</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Heartbeat can prepare a short summary of your week each Friday — wins,
                  what shifted, and what&apos;s next. Pick a day and time that suits you.
                </p>
              </header>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Send me a weekly review</p>
                  <p className="text-xs text-muted-foreground">
                    Delivered by email at your chosen time.
                  </p>
                </div>
                <Switch checked={reviewEnabled} onCheckedChange={setReviewEnabled} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Day</Label>
                  <Select
                    value={String(reviewDay)}
                    onValueChange={(v) => setReviewDay(Number(v))}
                    disabled={!reviewEnabled}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d.v} value={String(d.v)}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hour</Label>
                  <Select
                    value={String(reviewHour)}
                    onValueChange={(v) => setReviewHour(Number(v))}
                    disabled={!reviewEnabled}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                          {h.toString().padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Timezone: {profileQ.data?.timezone ?? "—"}
              </p>

              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={() => finish.mutate()} disabled={finish.isPending}>
                  {finish.isPending ? "Finishing…" : "Finish"}
                  <Check className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
