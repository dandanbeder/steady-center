import { createFileRoute } from "@tanstack/react-router";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="max-w-3xl mx-auto px-8 py-16">
      <h1 className="text-4xl text-primary">{title}</h1>
      <p className="mt-3 text-muted-foreground">Coming soon.</p>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/calendar")({
  component: () => <Placeholder title="Calendar" />,
});
