import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy · Heartbeat" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 prose prose-sm">
      <h1 className="text-3xl text-primary mb-4">Privacy Policy</h1>
      <p className="text-muted-foreground">
        Heartbeat collects only the data needed to run your account. We never sell your data.
        Email and authentication is handled through our infrastructure providers. Contact
        privacy@flightmed.software for any data request.
      </p>
      <p className="mt-6 text-sm">
        <Link to="/" className="text-accent hover:underline">← Back to Heartbeat</Link>
      </p>
    </div>
  );
}
