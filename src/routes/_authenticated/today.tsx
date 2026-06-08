import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { listCalendars, listEvents } from "@/lib/calendars";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { mondayOf } from "@/lib/weekly-plan";
import { getOnboardingProfile } from "@/lib/onboarding";
import { MyInvitationsBanner } from "@/components/my-invitations-banner";
import { TodayAnnouncements } from "@/components/today-announcements";
import { UpcomingMeetings } from "@/components/upcoming-meetings";
import { DailyPulseCard } from "@/components/daily-pulse-card";
import { WeekPulse } from "@/components/week-pulse";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/tasks";
import type { Note } from "@/lib/notes";


export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({ meta: [{ title: "Today · Heartbeat" }] }),
  component: TodayPage,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Top open tasks. Prefers tasks committed to this week, then falls back to
 * anything else due today or overdue, so committed work always surfaces first.
 * Optionally scoped to a single business (account).
 */
async function listTopOpenTasks(limit = 5, businessId: string | null = null): Promise<Task[]> {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const mondayStr = mondayOf();

  const apply = <T extends { eq: (col: string, val: string) => T }>(q: T): T =>
    businessId ? q.eq("business_id", businessId) : q;

  const [committed, dueSoon] = await Promise.all([
    apply(
      supabase
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .neq("status", "done")
        .eq("committed_week", mondayStr),
    )
      .order("priority", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit),
    apply(
      supabase
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .neq("status", "done")
        .or(`due_at.is.null,due_at.lte.${end.toISOString()}`),
    )
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit),
  ]);
  if (committed.error) throw committed.error;
  if (dueSoon.error) throw dueSoon.error;

  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const t of [...(committed.data ?? []), ...(dueSoon.data ?? [])] as Task[]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
    if (merged.length >= limit) break;
  }
  return merged;
}

async function listRecentNotes(limit = 5): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, updated_at, business_id, pinned")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Note[];
}

function TodayPage() {
  const { user } = useAuth();
  const { activeId } = useActiveBusiness();

  const start = startOfDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // All queries fire in parallel — react-query handles dedupe and SWR caching.
  const businessesQ = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const calendarsQ = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });
  const eventsQ = useQuery({
    queryKey: ["events", "today", start.toISOString()],
    queryFn: () => listEvents(start, end),
  });
  const businessScope = activeId === ALL ? null : activeId;
  const topTasksQ = useQuery({
    queryKey: ["tasks", "today-top", 5, businessScope],
    queryFn: () => listTopOpenTasks(5, businessScope),
  });
  const recentNotesQ = useQuery({
    queryKey: ["notes", "recent", 5],
    queryFn: () => listRecentNotes(5),
  });

  const businesses = businessesQ.data ?? [];
  const calendars = calendarsQ.data ?? [];
  const events = eventsQ.data ?? [];
  const topTasks = topTasksQ.data ?? [];
  const recentNotes = recentNotesQ.data ?? [];

  const active = activeId === ALL ? null : businesses.find((b) => b.id === activeId);
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
  const todays = events
    .filter((e) => activeId === ALL || e.business_id === activeId)
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
      <MyInvitationsBanner />
      <TodayAnnouncements />

      <p className="text-sm text-muted-foreground uppercase tracking-wider">{today}</p>
      <h1 className="text-3xl sm:text-4xl lg:text-5xl mt-3 text-primary">
        {greeting()}{name ? `, ${name}` : ""}.
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        {active
          ? <>You're focused on <span className="text-accent">{active.name}</span> today.</>
          : "Looking across everything today."}
      </p>
      <div className="mt-10"><DailyPulseCard /></div>

      <section className="mt-8 rounded-xl border border-border bg-card/40 px-4 pt-3 pb-2" style={{ boxShadow: "var(--shadow-soft)" }}>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Week pulse</h2>
          <span className="text-[10px] text-muted-foreground/70">tap a day</span>
        </div>
        <WeekPulse />
      </section>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card title="Today's events">
          {eventsQ.isLoading ? (
            <SkeletonList />
          ) : todays.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {todays.map((e) => {
                const c = calById.get(e.calendar_id);
                return (
                  <li
                    key={e.id}
                    className="text-sm pl-3"
                    style={{ borderLeft: `3px solid ${c?.color ?? "#888"}` }}
                  >
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.all_day
                        ? "All day"
                        : new Date(e.start_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      {c && <> · {c.name}</>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="On your plate">
          {topTasksQ.isLoading ? (
            <SkeletonList />
          ) : topTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due. Nice.</p>
          ) : (
            <ul className="space-y-2">
              {topTasks
                .filter((t) => activeId === ALL || t.business_id === activeId)
                .map((t) => (
                  <li key={t.id} className="text-sm">
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.due_at
                        ? new Date(t.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                        : "No due date"}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        <Card title="Recent notes">
          {recentNotesQ.isLoading ? (
            <SkeletonList />
          ) : (() => {
            const visible = recentNotes.filter((n) => activeId === ALL || n.business_id === activeId);
            if (visible.length === 0) {
              return (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                  <Link to="/notes" className="text-sm text-accent hover:underline">Create your first note →</Link>
                </div>
              );
            }
            return (
              <ul className="space-y-2">
                {visible.map((n) => (
                  <li key={n.id} className="text-sm">
                    <Link to="/notes" className="font-medium truncate block hover:text-accent">
                      {n.title || "Untitled"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Card>
        <Card title="Upcoming meetings"><UpcomingMeetings horizonDays={7} limit={5} /></Card>
      </div>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <h3 className="text-lg mb-3">{title}</h3>
      {children}
    </div>
  );
}
