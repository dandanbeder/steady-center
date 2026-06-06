import { createFileRoute, Link } from "@tanstack/react-router";
import { BacklogPanel } from "@/components/backlog-panel";
import { Button } from "@/components/ui/button";
import { BrainCircuit } from "lucide-react";

export const Route = createFileRoute("/_authenticated/backlog")({
  head: () => ({
    meta: [
      { title: "Backlog · Heartbeat" },
      { name: "description", content: "Tasks waiting to be committed to a week." },
    ],
  }),
  component: BacklogPage,
});

function BacklogPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl text-primary">Backlog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open tasks you haven't committed to a week yet, plus anything that rolled over.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/plan-week">
            <BrainCircuit className="h-4 w-4 mr-2" />
            Plan my week
          </Link>
        </Button>
      </div>

      <BacklogPanel scoped />
    </div>
  );
}
