import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms · Heartbeat" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 prose prose-sm">
      <h1 className="text-3xl text-primary mb-4">Terms of Service</h1>
      <p className="text-muted-foreground">
        Heartbeat is operated by FlightMed (PTY) Ltd. By using this service you agree to use it
        lawfully and responsibly. Full terms are available on request.
      </p>
      <p className="mt-6 text-sm">
        <Link to="/" className="text-accent hover:underline">← Back to Heartbeat</Link>
      </p>
    </div>
  );
}
