import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Video, Share2, FileText } from "lucide-react";
import { useActiveBusiness, ALL, PERSONAL, matchesActiveBusiness } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { listCalendars, listEvents, type EventRow } from "@/lib/calendars";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { mondayOf } from "@/lib/weekly-plan";
import { getOnboardingProfile } from "@/lib/onboarding";
import { MyInvitationsBanner } from "@/components/my-invitations-banner";
import { TodayAnnouncements } from "@/components/today-announcements";
import { DailyPulseCard } from "@/components/daily-pulse-card";
import { WeekPulse } from "@/components/week-pulse";
import { Skeleton } from "@/components/ui/skeleton";
import { OutcomeMark } from "@/components/outcomes/outcome-mark";
import { listOutcomes } from "@/lib/outcomes";
import { listSharedWithMeResources, type SharedItemRow } from "@/lib/shares.functions";
import type { Task } from "@/lib/tasks";
import { listNotes } from "@/lib/notes";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayEventsQueryOptions = () => {
  const start = startOfDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    queryKey: ["events", "today", start.toISOString()] as const,
    queryFn: () => listEvents(start, end),
  };
};

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({ meta: [{ title: "Today · Heartbeat" }] }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(todayEventsQueryOptions());
  },
  component: TodayPage,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Today's open tasks: anything due today or earlier (overdue counts), plus committed-week items. */
async function listTodaysOpenTasks(businessId: string | null = null): Promise<Task[]> {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const mondayStr = mondayOf();
  const apply = <T extends { eq: (col: string, val: string) => T; is: (col: string, val: null) => T }>(q: T): T => {
    if (businessId === PERSONAL) return q.is("business_id", null);
    if (businessId) return q.eq("business_id", businessId);
    return q;
  };
  const [committed, dueSoon] = await Promise.all([
    apply(
      supabase.from("tasks").select("*").is("deleted_at", null).neq("status", "done").eq("committed_week", mondayStr),
    ).order("priority", { ascending: true }).order("due_at", { ascending: true, nullsFirst: false }).limit(10),
    apply(
      supabase.from("tasks").select("*").is("deleted_at", null).neq("status", "done").not("due_at", "is", null).lte("due_at", end.toISOString()),
    ).order("due_at", { ascending: true }).limit(10),
  ]);
  if (committed.error) throw committed.error;
  if (dueSoon.error) throw dueSoon.error;
  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const t of [...(committed.data ?? []), ...(dueSoon.data ?? [])] as Task[]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
  }
  return merged;
}

function TodayPage() {
  const { user } = useAuth();
  const { activeId } = useActiveBusiness();

  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const calendarsQ = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });

  // ONE shared events query for today, used by BOTH cards so they never disagree.
  const eventsQ = useQuery(todayEventsQueryOptions());

  const businessScope = activeId === ALL ? null : activeId;
  const tasksQ = useQuery({
    queryKey: ["tasks", "today-open", businessScope],
    queryFn: () => listTodaysOpenTasks(businessScope),
  });
  const outcomesQ = useQuery({ queryKey: ["outcomes", "all-names"], queryFn: () => listOutcomes() });

  // Shared with me — gracefully empty if the system isn't available.
  const sharedQ = useQuery<SharedItemRow[]>({
    queryKey: ["shared-with-me", "today-card"],
    queryFn: () => listSharedWithMeResources(),
    retry: false,
  });
  const sharedItems = (sharedQ.data ?? []).slice(0, 3);

  // Account-scoped Notes preview — only when the user has filtered to a specific
  // account (a real business or Personal/Uncategorised). RLS on `notes` already
  // restricts to owner/shared; we additionally filter by the active account.
  const notesEnabled = activeId !== ALL;
  const notesQ = useQuery({
    queryKey: ["notes", "today-card", activeId],
    queryFn: () => listNotes(),
    enabled: notesEnabled,
  });
  const accountNotes = notesEnabled
    ? (notesQ.data ?? [])
        .filter((n) => matchesActiveBusiness(n.business_id, activeId))
        .slice(0, 4)
    : [];


  const businesses = businessesQ.data ?? [];
  const calendars = calendarsQ.data ?? [];
  const events = eventsQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const outcomeNameById = new Map((outcomesQ.data ?? []).map((o) => [o.id, o.name]));

  const active = activeId === ALL || activeId === PERSONAL ? null : businesses.find((b) => b.id === activeId);
  const profileQ = useQuery({ queryKey: ["onboarding-profile"], queryFn: getOnboardingProfile });
  const profileName = (profileQ.data?.full_name ?? "").trim();
  const metaName = (user?.user_metadata?.full_name as string | undefined) ?? "";
  const name = (profileName || metaName).split(" ")[0] || undefined;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const calById = new Map(calendars.map((c) => [c.id, c]));
  const todays: EventRow[] = events
    .filter((e) => matchesActiveBusiness(e.business_id, activeId))
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));

  // Derived "today" subsets from the shared events list.
  const now = new Date();
  const upcomingMeetings = todays
    .filter((e) => e.is_meeting && +new Date(e.start_at) >= now.getTime())
    .slice(0, 3);
  const visibleTasks = tasks.filter((t) => matchesActiveBusiness(t.business_id, activeId)).slice(0, 5);

  const dateKey = todayKey();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
      <MyInvitationsBanner />
      <TodayAnnouncements />

      <p className="text-sm text-muted-foreground uppercase tracking-wider">{today}</p>
      <h1 className="text-2xl sm:text-4xl lg:text-5xl mt-3 text-primary">
        {greeting()}{name ? `, ${name}` : ""}.
      </h1>
      <p className="mt-3 sm:mt-4 text-base sm:text-lg text-muted-foreground">
        {active
          ? <>You're focused on <span className="text-accent">{active.name}</span> today.</>
          : "Looking across everything today."}
      </p>

      <div className="mt-10" data-tour="daily-pulse"><DailyPulseCard /></div>

      <section data-tour="week-pulse" className="mt-8 rounded-xl border border-border bg-card/40 px-4 pt-3 pb-2" style={{ boxShadow: "var(--shadow-soft)" }}>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Week pulse</h2>
          <span className="text-[10px] text-muted-foreground/70">tap a day</span>
        </div>
        <WeekPulse />
      </section>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {/* TODAY'S EVENTS — header links to today in the calendar; each row links to its event */}
        <Card
          title="Today's events"
          action={
            <Link
              to="/calendar"
              search={{ date: dateKey, view: "day" } as never}
              className="text-xs text-muted-foreground hover:text-accent transition-colors"
            >
              Open day →
            </Link>
          }
        >
          {eventsQ.isLoading ? (
            <SkeletonList />
          ) : todays.length === 0 ? (
            <EmptyState text="Nothing scheduled." />
          ) : (
            <ul className="space-y-2">
              {todays.map((e) => {
                const c = calById.get(e.calendar_id);
                return (
                  <li key={e.id}>
                    <Link
                      to="/calendar"
                      search={{ date: dateKey, view: "day", eventId: e.id } as never}
                      className="block text-sm pl-3 rounded hover:bg-muted/40 transition-colors py-1"
                      style={{ borderLeft: `3px solid ${c?.color ?? "#888"}` }}
                    >
                      <div className="font-medium truncate">{e.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.all_day
                          ? "All day"
                          : new Date(e.start_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        {c && <> · {c.name}</>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>


        {/* ON YOUR PLATE — tasks + today's upcoming meetings (same source) + shared with me */}
        <Card title="On your plate">
          {(tasksQ.isLoading || eventsQ.isLoading) ? (
            <SkeletonList />
          ) : (visibleTasks.length === 0 && upcomingMeetings.length === 0 && sharedItems.length === 0) ? (
            <EmptyState text="Nothing on your plate. Enjoy the quiet." />
          ) : (
            <div className="space-y-4">
              {visibleTasks.length > 0 && (
                <Section label="Tasks">
                  <ul className="space-y-2">
                    {visibleTasks.map((t) => (
                      <li key={t.id}>
                        <Link
                          to="/tasks"
                          className="block text-sm rounded hover:bg-muted/40 transition-colors py-1 px-1 -mx-1"
                        >
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{t.title}</span>
                            {t.outcome_id && (
                              <OutcomeMark
                                outcomeId={t.outcome_id}
                                outcomeName={outcomeNameById.get(t.outcome_id)}
                              />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground pl-5">
                            {t.due_at
                              ? new Date(t.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                              : "No due date"}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {upcomingMeetings.length > 0 && (
                <Section label="Upcoming meetings today">
                  <ul className="space-y-2">
                    {upcomingMeetings.map((e) => {
                      const c = calById.get(e.calendar_id);
                      return (
                        <li key={e.id}>
                          <Link
                            to="/calendar"
                            search={{ date: dateKey, view: "day", eventId: e.id }}
                            className="block text-sm rounded hover:bg-muted/40 transition-colors py-1 px-1 -mx-1"
                          >
                            <div className="font-medium truncate flex items-center gap-1.5">
                              <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">{e.title}</span>
                            </div>
                            <div className="text-xs text-muted-foreground pl-5">
                              {new Date(e.start_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                              {c && <> · {c.name}</>}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {sharedItems.length > 0 && (
                <Section label="Shared with me">
                  <ul className="space-y-2">
                    {sharedItems.map((s) => (
                      <li key={s.share_id}>
                        <Link
                          to="/shared"
                          className="block text-sm rounded hover:bg-muted/40 transition-colors py-1 px-1 -mx-1"
                        >
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <Share2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{s.title || "Untitled"}</span>
                          </div>
                          <div className="text-xs text-muted-foreground pl-5 truncate">
                            {s.subtitle ?? s.resource_type}
                            {s.owner_name ? ` · from ${s.owner_name}` : ""}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </Card>
      </div>

      {notesEnabled && (
        <div className="mt-4">
          <Card
            title={
              activeId === PERSONAL
                ? "Recent notes · Personal"
                : `Recent notes${active ? ` · ${active.name}` : ""}`
            }
            action={
              <Link
                to="/notes"
                className="text-xs text-muted-foreground hover:text-accent transition-colors"
              >
                Open notes →
              </Link>
            }
          >
            {notesQ.isLoading ? (
              <SkeletonList />
            ) : accountNotes.length === 0 ? (
              <EmptyState
                text={
                  activeId === PERSONAL
                    ? "No personal notes yet."
                    : "No notes in this account yet."
                }
              />
            ) : (
              <ul className="space-y-2">
                {accountNotes.map((n) => (
                  <li key={n.id}>
                    <Link
                      to="/notes"
                      search={{ noteId: n.id } as never}
                      className="block text-sm rounded hover:bg-muted/40 transition-colors py-1 px-1 -mx-1"
                    >
                      <div className="font-medium truncate flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{n.title || "Untitled"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground pl-5">
                        {new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

