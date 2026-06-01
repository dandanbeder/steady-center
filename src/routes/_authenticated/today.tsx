import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { listCalendars, listEvents } from "@/lib/calendars";
import { useAuth } from "@/hooks/use-auth";

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

function TodayPage() {
  const { user } = useAuth();
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: calendars = [] } = useQuery({ queryKey: ["calendars"], queryFn: listCalendars });

  const start = startOfDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data: events = [] } = useQuery({
    queryKey: ["events", start.toISOString(), end.toISOString()],
    queryFn: () => listEvents(start, end),
  });

  const active = activeId === ALL ? null : businesses.find((b) => b.id === activeId);
  const name = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];

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
      <p className="text-sm text-muted-foreground uppercase tracking-wider">{today}</p>
      <h1 className="text-5xl mt-3 text-primary">
        {greeting()}{name ? `, ${name}` : ""}.
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        {active
          ? <>You're focused on <span className="text-accent">{active.name}</span> today.</>
          : "Looking across everything today."}
      </p>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card title="Today's events">
          {todays.length === 0 ? (
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
        <Card title="On your plate"><p className="text-sm text-muted-foreground">Tasks will land here.</p></Card>
        <Card title="Recent notes"><p className="text-sm text-muted-foreground">Notes you've touched lately.</p></Card>
        <Card title="Meetings"><p className="text-sm text-muted-foreground">Today's and upcoming meetings.</p></Card>
      </div>
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
