import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Calendar as CalendarIcon,
  User,
  Users,
  Mail,
  Plus,
  X,
} from "lucide-react";
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
import { inviteByEmail, listMyInvitations } from "@/lib/invitations.functions";
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

type Path = "choose" | "solo" | "team";

function OnboardingPage() {
  const navigate = useNavigate();
  const [path, setPath] = useState<Path>("choose");
  const [step, setStep] = useState(0); // 0 = pick path, 1 = account/team, 2 = calendar, 3 = review

  const profileQ = useQuery({ queryKey: ["onboarding-profile"], queryFn: getOnboardingProfile });
  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  // Path C, pending invitations
  const listInvites = useServerFn(listMyInvitations);
  const invitesQ = useQuery({ queryKey: ["my-invitations"], queryFn: () => listInvites() });
  const pendingInvites = (invitesQ.data ?? []).filter((i) => !i.request_status);

  // Step 1, solo account / team
  const [accountName, setAccountName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);

  // Step 3, weekly review
  const [reviewDay, setReviewDay] = useState<number>(5);
  const [reviewHour, setReviewHour] = useState<number>(16);
  const [reviewEnabled, setReviewEnabled] = useState(true);

  const inviteFn = useServerFn(inviteByEmail);

  const createAccount = useMutation({
    mutationFn: () => createBusiness(accountName.trim(), color),
    onSuccess: () => {
      businessesQ.refetch();
      setStep(2);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create account"),
  });

  const createTeam = useMutation({
    mutationFn: async () => {
      const biz = await createBusiness(accountName.trim(), color);
      const emails = inviteEmails.map((e) => e.trim()).filter(Boolean);
      let invited = 0;
      for (const email of emails) {
        try {
          await inviteFn({
            data: { business_id: biz.id, email, role: "member" },
          });
          invited++;
        } catch (e) {
          console.error("invite failed", email, e);
        }
      }
      return { biz, invited, attempted: emails.length };
    },
    onSuccess: (r) => {
      businessesQ.refetch();
      if (r.attempted > 0) {
        toast.success(
          r.invited === r.attempted
            ? `Team created. ${r.invited} invitation${r.invited === 1 ? "" : "s"} sent.`
            : `Team created. ${r.invited}/${r.attempted} invitations sent.`,
        );
      } else {
        toast.success("Team created");
      }
      setStep(2);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create team"),
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
  const totalSteps = 3;
  const progressStep = path === "choose" ? 0 : step;

  function setEmailAt(idx: number, val: string) {
    setInviteEmails((arr) => arr.map((e, i) => (i === idx ? val : e)));
  }
  function addEmailRow() {
    setInviteEmails((arr) => (arr.length >= 10 ? arr : [...arr, ""]));
  }
  function removeEmailAt(idx: number) {
    setInviteEmails((arr) => (arr.length === 1 ? [""] : arr.filter((_, i) => i !== idx)));
  }

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

        {path !== "choose" && (
          <ol className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((n) => (
              <li
                key={n}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  n <= progressStep ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
            <span className="sr-only">Step {progressStep} of {totalSteps}</span>
          </ol>
        )}

        <div
          className="rounded-2xl border border-border bg-card p-8"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          {step === 0 && path === "choose" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">How will you use Heartbeat?</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick what fits today, you can change this anytime. Solo is the
                  quickest way in; you can invite people later from any account.
                </p>
              </header>

              {pendingInvites.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const first = pendingInvites[0];
                    navigate({ to: "/accept-invite", search: { token: first.token } });
                  }}
                  className="w-full text-left rounded-xl border-2 border-accent/40 bg-accent/5 p-4 hover:border-accent transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Mail className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        You've been invited
                        {pendingInvites.length > 1 ? ` (${pendingInvites.length})` : ""}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Join <strong>{pendingInvites[0].business_name}</strong> as{" "}
                        {pendingInvites[0].proposed_role}. You'll also get your own
                        private personal workspace.
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                </button>
              )}

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPath("solo");
                    setStep(1);
                  }}
                  className="text-left rounded-xl border-2 border-primary bg-primary/5 p-4 hover:border-primary/80 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <User className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm">Just for me</div>
                        <span className="text-[10px] uppercase tracking-wide rounded bg-primary/15 text-primary px-1.5 py-0.5">
                          Recommended
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your private workspace, accounts, tasks, calendar, notes,
                        journal. Free or Pro. Invite a teammate anytime.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPath("team");
                    setStep(1);
                  }}
                  className="text-left rounded-xl border border-border p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">For my team</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Name your team, invite members by email. You become the owner
                        and still get your own private workspace underneath.
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              <p className="text-xs text-muted-foreground pt-1">
                You can switch later, solo accounts can invite a teammate anytime
                without moving any data.
              </p>
            </section>
          )}

          {step === 1 && path === "solo" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Create your first Account</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Accounts let you keep different areas of work separate, each gets
                  its own color, calendars, and tasks. You can add more later.
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
              <ColorPicker color={color} setColor={setColor} />
              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => { setPath("choose"); setStep(0); }}>
                  Back
                </Button>
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
                  You already have an account set up, you can skip this step.{" "}
                  <button onClick={() => setStep(2)} className="text-accent hover:underline">
                    Continue
                  </button>
                </p>
              )}
            </section>
          )}

          {step === 1 && path === "team" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Name your team</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Your team is also your first Account, shared work lives here.
                  You'll be the owner, and you still get your own private workspace.
                </p>
              </header>
              <div className="space-y-2">
                <Label htmlFor="team">Team name</Label>
                <Input
                  id="team"
                  placeholder="e.g. Acme Co, Studio Friday"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  autoFocus
                />
              </div>
              <ColorPicker color={color} setColor={setColor} />
              <div className="space-y-2">
                <Label>Invite members <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="space-y-2">
                  {inviteEmails.map((email, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="teammate@example.com"
                        value={email}
                        onChange={(e) => setEmailAt(i, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmailAt(i)}
                        aria-label="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {inviteEmails.length < 10 && (
                    <Button type="button" variant="ghost" size="sm" onClick={addEmailRow}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add another
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  They'll receive an email invite. Billing engages per seat when a
                  paid teammate accepts, you can also do this later.
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => { setPath("choose"); setStep(0); }}>
                  Back
                </Button>
                <Button
                  onClick={() => createTeam.mutate()}
                  disabled={!accountName.trim() || createTeam.isPending}
                >
                  {createTeam.isPending ? "Creating…" : "Create team"}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5">
              <header>
                <h1 className="text-2xl text-primary">Connect a calendar</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Sync Google or Microsoft Outlook so events flow into Heartbeat. You
                  can do this later from Settings.
                </p>
              </header>
              <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-3">
                <CalendarIcon className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Connect from Settings → Connections</p>
                  <p className="text-muted-foreground mt-1">
                    We'll keep your calendars in sync in the background.
                  </p>
                </div>
              </div>
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
                  Heartbeat can prepare a short summary of your week, wins, what
                  shifted, and what's next. Pick a day and time that suits you.
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
                Timezone: {profileQ.data?.timezone ?? ","}
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

function ColorPicker({ color, setColor }: { color: string; setColor: (c: string) => void }) {
  return (
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
  );
}
