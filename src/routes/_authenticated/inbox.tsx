import { createFileRoute, redirect } from "@tanstack/react-router";

// Permanent redirect: the page formerly at /inbox now lives at /capture.
// Old links, bookmarks, and notifications continue to work.
export const Route = createFileRoute("/_authenticated/inbox")({
  beforeLoad: () => {
    throw redirect({ to: "/capture", replace: true });
  },
});
