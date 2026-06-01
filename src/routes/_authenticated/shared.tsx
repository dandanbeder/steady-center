import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CheckSquare, FileText, Calendar as CalendarIcon, Inbox } from "lucide-react";
import { listSharedWithMe } from "@/lib/item-tags.functions";

export const Route = createFileRoute("/_authenticated/shared")({
  head: () => ({ meta: [{ title: "Shared with me · Heartbeat" }] }),
  component: SharedPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground" role="alert">
      Couldn't load shared items: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

function SharedPage() {
  const fetchShared = useServerFn(listSharedWithMe);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["shared-with-me"],
    queryFn: () => fetchShared(),
  });

  const grouped = useMemo(() => {
    const m = new Map<string, { name: string; items: typeof rows }>();
    for (const r of rows) {
      const g = m.get(r.business_id);
      if (g) g.items.push(r);
      else m.set(r.business_id, { name: r.business_name, items: [r] });
    }
    return [...m.values()];
  }, [rows]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-10">
      <header className="mb-6">
        <h1 className="text-2xl font-serif">Shared with me</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tasks, notes and events you've been tagged on across every space.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Nothing shared with you yet. When someone tags you on a task, note, or event it'll show up here.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((g) => (
          <section key={g.name}>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {g.name}
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {g.items.map((r) => {
                const Icon =
                  r.item_type === "task"
                    ? CheckSquare
                    : r.item_type === "note"
                      ? FileText
                      : CalendarIcon;
                const to =
                  r.item_type === "task"
                    ? "/tasks"
                    : r.item_type === "note"
                      ? "/notes"
                      : "/calendar";
                return (
                  <li key={r.tag_id} className="bg-card">
                    <Link
                      to={to}
                      className="flex items-start gap-3 p-3 hover:bg-muted transition-colors"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {r.title}
                        </div>
                        {r.subtitle && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {r.subtitle}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        {r.item_type}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
