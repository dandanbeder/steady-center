import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: () => (
    <div className="max-w-3xl mx-auto px-8 py-16">
      <h1 className="text-4xl text-primary">Meetings</h1>
      <p className="mt-3 text-muted-foreground">Coming soon.</p>
    </div>
  ),
});
