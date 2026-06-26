import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Calendar as CalendarIcon,
  CheckCircle2,
  Circle,
  Sparkles,
  Target,
  Sunrise,
  Wallet,
  HelpCircle,
  Play,
  Inbox,
  Users,
  Lock,
  Settings as SettingsIcon,
  BookOpen,
  Heart,
  Layers,
  CalendarRange,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listBusinesses } from "@/lib/businesses";
import { listCalendars } from "@/lib/calendars";
import { listOutcomes } from "@/lib/outcomes";
import { listNotes } from "@/lib/notes";
import { listMeetings } from "@/lib/meetings";
import { getMyAiUsage } from "@/lib/ai-usage.functions";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import welcomePoster from "@/assets/learn-welcome-poster.jpg";

export const Route = createFileRoute("/_authenticated/learn")({
  head: () => ({
    meta: [
      { title: "Tutorial · Heartbeat" },
      {
        name: "description",
        content:
          "A calm, chronological walk through Heartbeat, from the big idea to setup, daily use, and making it your own.",
      },
    ],
  }),
  component: LearnPage,
});

// Drop a hosted video URL (mp4/webm) when ready. Empty = "coming soon" card.
const WELCOME_VIDEO_URL = "";
const WELCOME_CAPTIONS_URL = "";

export function welcomedStorageKey(userId: string) {
  return `heartbeat:welcomed:${userId}`;
}

type Phase = { id: string; label: string; chapters: number[] };
const PHASES: Phase[] = [
  { id: "understand", label: "Phase 1 · Understand", chapters: [1, 2] },
  { id: "setup", label: "Phase 2 · Set up", chapters: [3, 4] },
  { id: "daily", label: "Phase 3 · Use it daily", chapters: [5, 6, 7] },
  { id: "deeper", label: "Phase 4 · Go deeper, make it yours", chapters: [8, 9, 10, 11, 12] },
];

function LearnPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Mark the per-user tutorial flag once they've landed here.
  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase
          .from("profiles")
          .update({ has_seen_tutorial: true })
          .eq("id", user.id)
          .is("has_seen_tutorial", false);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(welcomedStorageKey(user.id), "1");
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, [user?.id]);

  // Auto-tick data
  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const calendarsQ = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const outcomesQ = useQuery({ queryKey: ["outcomes", "learn"], queryFn: () => listOutcomes() });
  const notesQ = useQuery({ queryKey: ["notes", "learn"], queryFn: listNotes });
  const meetingsQ = useQuery({ queryKey: ["meetings", "learn"], queryFn: () => listMeetings() });
  const aiUsageFn = useServerFn(getMyAiUsage);
  const aiUsageQ = useQuery({
    queryKey: ["ai-usage", "learn-tiny"],
    queryFn: () => aiUsageFn({ data: { limit: 1 } }),
  });

  const hasBusinesses = (businessesQ.data ?? []).length > 0;
  const hasCalendar = (calendarsQ.data ?? []).length > 0;
  const hasOutcome = (outcomesQ.data ?? []).length > 0;
  const hasNote = (notesQ.data ?? []).length > 0;
  const hasMeeting = (meetingsQ.data ?? []).length > 0;
  const triedAi = ((aiUsageQ.data?.items ?? []) as unknown[]).length > 0;

  const checklist = useMemo(
    () => [
      { id: "account", label: "Create your first account", done: hasBusinesses, href: "/settings", hint: "Settings → Accounts" },
      { id: "calendar", label: "Connect a calendar", done: hasCalendar, href: "/settings", hint: "Settings → Connections" },
      { id: "capture", label: "Capture your first item", done: hasNote || hasMeeting, href: "/capture", hint: "Capture · catch anything" },
      { id: "outcome", label: "Set your first outcome", done: hasOutcome, href: "/outcomes", hint: "Outcomes → New outcome" },
      { id: "ai", label: "Try AI once", done: triedAi, href: "/ai", hint: "Ask Heartbeat, summarise, plan" },
    ],
    [hasBusinesses, hasCalendar, hasNote, hasMeeting, hasOutcome, triedAi],
  );

  const doneCount = checklist.filter((c) => c.done).length;
  const allDone = doneCount === checklist.length;
  const progressPct = Math.round((doneCount / checklist.length) * 100);

  // Per-user checklist collapse: auto-recedes when complete.
  const checklistCollapseKey = user?.id ? `heartbeat:learn:checklist-collapsed:${user.id}` : "";
  const [checklistCollapsed, setChecklistCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const stored = window.localStorage.getItem(checklistCollapseKey);
    if (stored === "1") setChecklistCollapsed(true);
    else if (stored === "0") setChecklistCollapsed(false);
    else if (allDone) setChecklistCollapsed(true);
  }, [user?.id, allDone, checklistCollapseKey]);
  const setCollapsed = (v: boolean) => {
    setChecklistCollapsed(v);
    if (typeof window !== "undefined" && checklistCollapseKey) {
      window.localStorage.setItem(checklistCollapseKey, v ? "1" : "0");
    }
  };

  const handlePlay = () => {
    if (!videoRef.current || !WELCOME_VIDEO_URL) return;
    videoRef.current.play().catch(() => undefined);
    setPlaying(true);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Hero */}
      <header className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">A calm walkthrough</p>
        <h1 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
          Welcome to Heartbeat
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Twelve short chapters, in order. Read at your pace, set things up as you go, come back any
          time from the nav.
        </p>
      </header>

      {/* Quick TOC */}
      <nav aria-label="Tutorial chapters" className="rounded-lg border border-border/60 bg-card/40 p-4">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {CHAPTERS.map((c) => (
            <li key={c.n}>
              <a
                href={`#chapter-${c.n}`}
                className="flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="tabular-nums text-xs text-muted-foreground/70 w-5">{c.n}.</span>
                <span className="truncate">{c.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Chapters by phase */}
      {PHASES.map((phase) => (
        <section key={phase.id} className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {phase.label}
            </span>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          {phase.chapters.map((n) => {
            const ch = CHAPTERS.find((c) => c.n === n)!;
            return (
              <Chapter key={n} n={n} title={ch.title} icon={ch.icon}>
                {n === 1 && (
                  <>
                    {/* Video / coming soon */}
                    <div className="overflow-hidden rounded-md border border-border/60 bg-muted">
                      <div className="relative aspect-video">
                        {WELCOME_VIDEO_URL ? (
                          <video
                            ref={videoRef}
                            className="w-full h-full object-cover"
                            poster={welcomePoster}
                            controls={playing}
                            preload="metadata"
                            playsInline
                          >
                            <source src={WELCOME_VIDEO_URL} />
                            {WELCOME_CAPTIONS_URL && (
                              <track kind="captions" src={WELCOME_CAPTIONS_URL} srcLang="en" label="English" default />
                            )}
                          </video>
                        ) : (
                          <img
                            src={welcomePoster}
                            alt="Heartbeat welcome"
                            width={1600}
                            height={900}
                            className="w-full h-full object-cover opacity-90"
                          />
                        )}
                        {!playing && (
                          <div className="absolute inset-0 flex items-center justify-center bg-foreground/10">
                            {WELCOME_VIDEO_URL ? (
                              <Button size="lg" onClick={handlePlay} className="gap-2 shadow-lg">
                                <Play className="h-5 w-5" /> Play welcome
                              </Button>
                            ) : (
                              <div className="text-center px-5 py-2 rounded-full bg-background/85 backdrop-blur text-xs text-muted-foreground">
                                Welcome video coming soon
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <p>
                      Heartbeat is a calm command centre for everything you run, your work, studies,
                      projects, and personal life, in one place that talks to itself.
                    </p>
                    <Principles />
                  </>
                )}

                {n === 2 && (
                  <>
                    <p>
                      You have <strong>one space</strong>, your calm home, and inside it you keep one
                      or more <strong>accounts</strong>. An account is a world you run, a business, a
                      side project, your studies, personal life. Everything you create (a task, a
                      note, an event, a meeting) belongs to an account, so the right things stay
                      together and the wrong things stay apart.
                    </p>
                    <Callout>
                      Learn this idea first. Once accounts make sense, the rest of Heartbeat clicks
                      into place.
                    </Callout>
                  </>
                )}

                {n === 3 && (
                  <>
                    <p>
                      Open the account switcher in the top bar and choose <em>New account</em>. Give it
                      a name (e.g. "Studio", "MBA", "Personal"). You can add more later, there's no
                      rush.
                    </p>
                    <ChapterCta to="/settings" label="Open Settings → Accounts" />
                  </>
                )}

                {n === 4 && (
                  <>
                    <p>
                      Connect Google or Microsoft so your real schedule flows into Heartbeat. Each
                      calendar maps to an account by default, so events land in the right world. You
                      can override any single event later.
                    </p>
                    <ChapterCta to="/settings" label="Open Settings → Connections" />
                  </>
                )}

                {n === 5 && (
                  <>
                    <p>
                      <strong>Today</strong> is your home base, what's on, what's overdue, what
                      matters. <strong>Capture</strong> is for catching anything in one tap, file it
                      later as a task, note, event, or meeting.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ChapterCta to="/today" label="Open Today" />
                      <ChapterCta to="/capture" label="Try Capture now" variant="outline" />
                    </div>
                  </>
                )}

                {n === 6 && (
                  <>
                    <p>
                      Five building blocks, designed to connect:
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      <li>· <strong>Tasks</strong>, the things to do</li>
                      <li>· <strong>Notes</strong>, your thinking</li>
                      <li>· <strong>Calendar</strong>, your real time</li>
                      <li>· <strong>Meetings</strong>, conversations that produce action</li>
                      <li>· <strong>Outcomes</strong>, the bigger goals tasks roll up into</li>
                    </ul>
                    <p>
                      A note becomes a task. A meeting produces action items. Tasks roll into an
                      outcome. Nothing lives alone.
                    </p>
                  </>
                )}

                {n === 7 && (
                  <>
                    <p>
                      <strong>My Week</strong> shows your capacity and what you've committed to.
                      <strong> Plan my week</strong> walks you through capacity, goals, and dragging
                      backlog items into your commitment for the week.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ChapterCta to="/my-week" label="Open My Week" />
                      <ChapterCta to="/plan-week" label="Plan my week" variant="outline" />
                    </div>
                  </>
                )}

                {n === 8 && (
                  <>
                    <p>
                      Heartbeat has two flavours of AI. <strong>Ambient AI</strong> is optional and
                      gentle, quiet suggestions you can switch off any time. <strong>Invoked
                      AI</strong> runs only when you ask, summarise this meeting, extract action
                      items, plan my week. Both fail gracefully, if credits run out or something
                      errors, your work is never lost.
                    </p>
                    <p>
                      Credits power AI. You'll see the cost before each heavy action.
                    </p>
                    <ChapterCta to="/billing" label="Open Plans & Billing" />
                  </>
                )}

                {n === 9 && (
                  <>
                    <p>
                      Your <strong>Journal</strong> is yours alone. It is never shared, never seen by
                      AI, never measured, and not visible to any team owner or admin. Super Admin
                      access is only possible with your explicit, time-boxed consent, logged each
                      time.
                    </p>
                    <Callout>This is a trust line we won't cross.</Callout>
                    <ChapterCta to="/journal" label="Open Journal" variant="outline" />
                  </>
                )}

                {n === 10 && (
                  <>
                    <p>
                      Sharing is private by default. You can share a note, meeting, or outcome into a
                      team space, or @mention a teammate so it lands in their <em>Shared with me</em>.
                      Joining a team never exposes your private work, the Journal stays sealed, and
                      private items stay private.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ChapterCta to="/team-access" label="Team & Access" />
                      <ChapterCta to="/shared" label="Shared with me" variant="outline" />
                    </div>
                  </>
                )}

                {n === 11 && (
                  <>
                    <p>
                      One place for the levers, Settings. Connections (calendars, integrations),
                      Appearance, Privacy & data, Notifications, and Plans & Billing, where your full
                      rights live.
                    </p>
                    <ChapterCta to="/settings" label="Open Settings" />
                  </>
                )}

                {n === 12 && (
                  <>
                    <p>That's the tour. From here, your getting-started checklist below will quietly tick itself off as you go.</p>
                    <div className="flex flex-wrap gap-2">
                      <ChapterCta to="/today" label="Go to Today" />
                      <ChapterCta to="/settings" label="Contact support" variant="outline" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You can revisit this tutorial any time from the nav.
                    </p>
                  </>
                )}
              </Chapter>
            );
          })}
        </section>
      ))}

      {/* Personal checklist, auto-ticks, recedes when complete */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h2 className="text-xl font-serif text-foreground">Your getting-started checklist</h2>
            <p className="text-sm text-muted-foreground">
              {allDone ? "All done. Lovely." : `${doneCount} of ${checklist.length} done. No rush.`}
            </p>
          </div>
          {(allDone || checklistCollapsed) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setCollapsed(!checklistCollapsed)}
            >
              {checklistCollapsed ? "Show steps" : "Hide"}
            </Button>
          )}
        </div>

        <div
          className="h-0.5 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={checklist.length}
          aria-valuenow={doneCount}
          aria-label="Getting started progress"
        >
          <div
            className="h-full bg-primary/70 transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {!checklistCollapsed && (
          <Card className="border-border/60">
            <ul className="divide-y divide-border/60">
              {checklist.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors",
                    c.done && "opacity-80",
                  )}
                >
                  {c.done ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm font-medium text-foreground", c.done && "line-through decoration-primary/60")}>
                      {c.label}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{c.hint}</div>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant={c.done ? "ghost" : "outline"}
                    className="shrink-0 h-7 text-xs"
                  >
                    <Link to={c.href}>{c.done ? "Open" : "Go"}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Help footer */}
      <section className="rounded-lg border border-border/60 bg-card/40 p-5 flex items-start gap-3">
        <HelpCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Stuck on something? The assistant in the top bar answers most questions, or open Settings
            for support.
          </p>
          <Button asChild size="sm" variant="outline" onClick={() => setCollapsed(false)}>
            <a href="#chapter-1">Revisit chapter 1</a>
          </Button>
        </div>
      </section>
    </div>
  );
}

// --- chapter data ---
const CHAPTERS: { n: number; title: string; icon: typeof Heart }[] = [
  { n: 1, title: "Welcome", icon: Heart },
  { n: 2, title: "The big idea, your space & accounts", icon: Building2 },
  { n: 3, title: "Create your first account", icon: Building2 },
  { n: 4, title: "Connect your calendars", icon: CalendarIcon },
  { n: 5, title: "Today & Capture, the daily loop", icon: Sunrise },
  { n: 6, title: "The building blocks & how they connect", icon: Layers },
  { n: 7, title: "Plan your week", icon: CalendarRange },
  { n: 8, title: "How AI works here, and credits", icon: Sparkles },
  { n: 9, title: "Your private Journal", icon: Lock },
  { n: 10, title: "Working with others", icon: Users },
  { n: 11, title: "Make it yours, Settings & access", icon: SettingsIcon },
  { n: 12, title: "You're set", icon: CheckCircle2 },
];

function Chapter({
  n,
  title,
  icon: Icon,
  children,
}: {
  n: number;
  title: string;
  icon: typeof Heart;
  children: React.ReactNode;
}) {
  return (
    <article
      id={`chapter-${n}`}
      className="scroll-mt-24 rounded-xl border border-border/60 bg-card/40 p-6 space-y-4"
    >
      <header className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary tabular-nums text-sm font-medium">
          {n}
        </span>
        <h3 className="text-lg font-serif text-foreground flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </h3>
      </header>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </article>
  );
}

function ChapterCta({
  to,
  label,
  variant = "default",
}: {
  to: string;
  label: string;
  variant?: "default" | "outline";
}) {
  return (
    <Button asChild size="sm" variant={variant} className="gap-1.5">
      <Link to={to}>
        {label}
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </Button>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border-l-2 border-primary/60 bg-primary/5 px-4 py-3 text-sm text-foreground/90">
      {children}
    </div>
  );
}

function Principles() {
  const items = [
    { label: "Interconnected", body: "Everything talks to everything else." },
    { label: "Calm", body: "Quiet by default, no streaks, no badges." },
    { label: "Private by default", body: "Yours unless you choose to share." },
    { label: "Yours", body: "Your data, your pace, your shape." },
  ];
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
      {items.map((p) => (
        <li key={p.label} className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
          <div className="text-xs font-medium text-foreground">{p.label}</div>
          <div className="text-xs text-muted-foreground">{p.body}</div>
        </li>
      ))}
    </ul>
  );
}

// Unused but exported for backwards-compat with previous tour entry points.
export const UnusedIcons = { Inbox, BookOpen, Wallet, Target };
