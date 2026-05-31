import { createFileRoute } from "@tanstack/react-router";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { useQuery } from "@tanstack/react-query";
import { listBusinesses } from "@/lib/businesses";
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

function TodayPage() {
  const { user } = useAuth();
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const active = activeId === ALL ? null : businesses.find((b) => b.id === activeId);
  const name = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-3xl mx-auto px-8 py-16">
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
        <Card title="On your plate" body="Tasks will land here." />
        <Card title="Coming up" body="Calendar events will surface here." />
        <Card title="Recent notes" body="Notes you've touched lately." />
        <Card title="Meetings" body="Today's and upcoming meetings." />
      </div>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <h3 className="text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
