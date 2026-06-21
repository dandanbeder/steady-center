import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
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
  SkipForward,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listBusinesses } from "@/lib/businesses";
import { listCalendars } from "@/lib/calendars";
import { listOutcomes } from "@/lib/outcomes";
import { getMyAiUsage } from "@/lib/ai-usage.functions";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import welcomePoster from "@/assets/learn-welcome-poster.jpg";
import { TOURS, isTourDone, resetTour } from "@/lib/tours";

export const Route = createFileRoute("/_authenticated/learn")({
  head: () => ({
    meta: [
      { title: "Learn · Heartbeat" },
      {
        name: "description",
        content:
          "A calm welcome to Heartbeat. Watch the intro, walk through the essentials, and see what's set up for you.",
      },
    ],
  }),
  component: LearnPage,
});

// Drop a hosted video URL (mp4/webm) here when ready. Leaving it empty
// renders the poster card with a friendly "video coming soon" note.
const WELCOME_VIDEO_URL = "";
const WELCOME_CAPTIONS_URL = "";

export function welcomedStorageKey(userId: string) {
  return `heartbeat:welcomed:${userId}`;
}

function LearnPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const calendarsQ = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const outcomesQ = useQuery({ queryKey: ["outcomes", "learn"], queryFn: () => listOutcomes() });
  const aiUsageFn = useServerFn(getMyAiUsage);
  const aiUsageQ = useQuery({
    queryKey: ["ai-usage", "learn-tiny"],
    queryFn: () => aiUsageFn({ data: { limit: 1 } }),
  });

  const hasBusinesses = (businessesQ.data ?? []).length > 0;
  const hasCalendar = (calendarsQ.data ?? []).length > 0;
  const hasOutcome = (outcomesQ.data ?? []).length > 0;
  const triedAi = ((aiUsageQ.data?.items ?? []) as unknown[]).length > 0;

  const checklist = [
    {
      id: "business",
      label: "Add your businesses",
      done: hasBusinesses,
      to: "/settings",
      hint: "Settings → Accounts",
    },
    {
      id: "calendar",
      label: "Connect a calendar",
      done: hasCalendar,
      to: "/calendar",
      hint: "Calendar → Connect Google or Microsoft",
    },
    {
      id: "outcome",
      label: "Create your first outcome",
      done: hasOutcome,
      to: "/outcomes",
      hint: "Outcomes → New outcome",
    },
    {
      id: "ai",
      label: "Try the AI",
      done: triedAi,
      to: "/ai",
      hint: "Open the assistant — ask, summarise, plan",
    },
  ];

  const doneCount = checklist.filter((c) => c.done).length;
  const allDone = doneCount === checklist.length;

  const markWelcomed = () => {
    if (typeof window !== "undefined" && user?.id) {
      window.localStorage.setItem(welcomedStorageKey(user.id), "1");
    }
  };

  const handleSkip = () => {
    markWelcomed();
    navigate({ to: "/today" });
  };

  const handlePlay = () => {
    if (!videoRef.current || !WELCOME_VIDEO_URL) return;
    videoRef.current.play().catch(() => undefined);
    setPlaying(true);
  };

  // Persist that the user has seen Learn once they've reached this page.
  useEffect(() => {
    if (user?.id) markWelcomed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const walkthroughs: Array<{
    icon: typeof Building2;
    title: string;
    body: string;
    tourId: keyof typeof TOURS;
    cta: string;
  }> = [
    {
      icon: Building2,
      title: "Accounts",
      body: "Accounts keep each business separate but together. Tag everything with the business it belongs to.",
      tourId: "accounts",
      cta: "Tour Accounts",
    },
    {
      icon: CalendarIcon,
      title: "Calendar",
      body: "Connect Google or Microsoft so Today, Plan and Meetings work from your real schedule.",
      tourId: "calendar",
      cta: "Tour Calendar",
    },
    {
      icon: Target,
      title: "Outcomes",
      body: "Bigger goals your tasks roll up into. Create one, link tasks, watch progress fill.",
      tourId: "outcomes",
      cta: "Tour Outcomes",
    },
    {
      icon: Sparkles,
      title: "The AI assistant",
      body: "Ask, summarise, plan. It only acts after you confirm.",
      tourId: "ai",
      cta: "Tour AI",
    },
    {
      icon: Sunrise,
      title: "Daily Pulse",
      body: "A calm morning brief — what's on, what's overdue, what matters today.",
      tourId: "today",
      cta: "Tour Today",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Hero */}
      <header className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
              Welcome to Heartbeat
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Heartbeat is one calm place to run all your businesses — calendar, tasks, notes,
              meetings, and goals, together and talking to each other.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSkip} className="gap-1.5">
            <SkipForward className="h-4 w-4" /> Skip for now
          </Button>
        </div>

        {/* Welcome video / poster */}
        <Card className="overflow-hidden border-border/60">
          <div className="relative bg-muted aspect-video">
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
                  <track
                    kind="captions"
                    src={WELCOME_CAPTIONS_URL}
                    srcLang="en"
                    label="English"
                    default
                  />
                )}
              </video>
            ) : (
              <img
                src={welcomePoster}
                alt="Heartbeat welcome"
                width={1600}
                height={900}
                className="w-full h-full object-cover"
              />
            )}
            {!playing && (
              <div className="absolute inset-0 flex items-center justify-center bg-foreground/10">
                {WELCOME_VIDEO_URL ? (
                  <Button
                    size="lg"
                    onClick={handlePlay}
                    className="gap-2 shadow-lg"
                    aria-label="Play welcome video"
                  >
                    <Play className="h-5 w-5" /> Play welcome (2 min)
                  </Button>
                ) : (
                  <div className="text-center px-6 py-3 rounded-full bg-background/85 backdrop-blur text-xs text-muted-foreground">
                    Welcome video coming soon — read on below.
                  </div>
                )}
              </div>
            )}
          </div>
          <CardContent className="flex items-center justify-between gap-3 py-3 text-xs text-muted-foreground">
            <span>Captions on. You can revisit this page any time from the help menu.</span>
            <Button variant="link" size="sm" onClick={handleSkip} className="h-auto p-0 text-xs">
              Continue to Today →
            </Button>
          </CardContent>
        </Card>
      </header>

      {/* Start here — each card launches a guided tour on the destination page */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-serif text-foreground">Start here</h2>
          <p className="text-sm text-muted-foreground">
            Each card opens the page and runs a short, skippable tour — 2 to 4 gentle steps,
            then it gets out of the way.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {walkthroughs.map((w) => {
            const Icon = w.icon;
            const done = user?.id ? isTourDone(user.id, w.tourId) : false;
            const route = TOURS[w.tourId].route;
            return (
              <Card
                key={w.title}
                className="border-border/60 hover:border-primary/40 transition-colors"
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-2 text-foreground">
                    <Icon className="h-4 w-4 text-primary" />
                    <h3 className="font-medium text-sm">{w.title}</h3>
                    {done && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary">
                        <CheckCircle2 className="h-3 w-3" /> Done
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{w.body}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={done ? "outline" : "default"}
                      onClick={() => {
                        if (done && user?.id) resetTour(user.id, w.tourId);
                        navigate({ to: route, search: { tour: w.tourId } as never });
                      }}
                    >
                      {done ? "Replay tour" : w.cta}
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={route}>Just open</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Checklist */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-serif text-foreground">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              {allDone
                ? "All set. Nicely done — you're up and running."
                : `${doneCount} of ${checklist.length} done. No rush.`}
            </p>
          </div>
          {allDone && (
            <span className="inline-flex items-center gap-1.5 text-xs text-primary">
              <CheckCircle2 className="h-4 w-4" /> Complete
            </span>
          )}
        </div>
        <Card className="border-border/60">
          <ul className="divide-y divide-border/60">
            {checklist.map((c) => (
              <li key={c.id}>
                <Link
                  to={c.to}
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
                    <div
                      className={cn(
                        "text-sm font-medium text-foreground",
                        c.done && "line-through decoration-primary/60",
                      )}
                    >
                      {c.label}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{c.hint}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {c.done ? "Done" : "Open →"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* AI credits + deeper help */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-primary" /> How AI credits work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Your plan includes a monthly AI allowance. Quick suggestions cost a little, long
              summaries cost more. If you run out, AI pauses — everything else keeps working.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/ai">Open AI wallet</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-4 w-4 text-primary" /> Need a hand?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Settings holds your accounts, calendars, weekly review and billing. The assistant in
              the top bar can answer most questions.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings">Open settings</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/today" onClick={markWelcomed}>
                  <X className="h-3.5 w-3.5 mr-1" /> Close
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
