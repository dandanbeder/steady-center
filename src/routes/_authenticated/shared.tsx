import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AtSign, CheckSquare, FileText, Calendar as CalendarIcon, Folder, ListTodo, Inbox, Building2, Video, Target,
} from "lucide-react";
import {
  listSharedWithMeResources,
  listMyMentionedItems,
  type SharedItemRow,
  type ResourceType,
} from "@/lib/shares.functions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

const ICONS: Record<ResourceType, typeof Folder> = {
  folder: Folder,
  list: ListTodo,
  task: CheckSquare,
  note: FileText,
  calendar: CalendarIcon,
  business: Building2,
  meeting: Video,
  outcome: Target,
};

const LINKS: Record<ResourceType, string> = {
  folder: "/tasks",
  list: "/tasks",
  task: "/tasks",
  note: "/notes",
  calendar: "/calendar",
  business: "/today",
  meeting: "/meetings",
  outcome: "/outcomes",
};

// Filter categories shown in the chip bar. We collapse the
// folder/list/calendar/business resource types into the bucket they best
// belong to so the surface stays calm and on-brand.
type FilterKey = "all" | "note" | "task" | "meeting" | "outcome" | "mention";

const FILTERS: { key: FilterKey; label: string; icon: typeof Folder }[] = [
  { key: "all", label: "All", icon: Inbox },
  { key: "note", label: "Notes", icon: FileText },
  { key: "task", label: "Tasks", icon: CheckSquare },
  { key: "meeting", label: "Meetings", icon: Video },
  { key: "outcome", label: "Outcomes", icon: Target },
  { key: "mention", label: "Mentioned", icon: AtSign },
];

const GROUP_ORDER: ResourceType[] = [
  "business", "folder", "list", "note", "task", "meeting", "outcome", "calendar",
];
const GROUP_LABELS: Record<ResourceType, string> = {
  folder: "Folders",
  list: "Lists",
  task: "Tasks",
  note: "Notes",
  calendar: "Calendars",
  business: "Accounts",
  meeting: "Meetings",
  outcome: "Outcomes",
};

function SharedPage() {
  const fetchShared = useServerFn(listSharedWithMeResources);
  const fetchMentions = useServerFn(listMyMentionedItems);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["shared-with-me"],
    queryFn: () => fetchShared(),
  });
  const { data: mentions = [], isLoading: mentionsLoading } = useQuery({
    queryKey: ["my-mentions"],
    queryFn: () => fetchMentions(),
  });

  const [filter, setFilter] = useState<FilterKey>("all");

  const shareKey = (r: SharedItemRow) => `${r.resource_type}:${r.resource_id}`;
  const sharedKeys = useMemo(() => new Set(rows.map(shareKey)), [rows]);
  const mentionRows = useMemo(
    () => mentions.filter((m) => !sharedKeys.has(shareKey(m))),
    [mentions, sharedKeys],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: rows.length + mentionRows.length,
      note: rows.filter((r) => r.resource_type === "note").length,
      task: rows.filter((r) => r.resource_type === "task").length,
      meeting: rows.filter((r) => r.resource_type === "meeting").length,
      outcome: rows.filter((r) => r.resource_type === "outcome").length,
      mention: mentionRows.length,
    };
    return c;
  }, [rows, mentionRows]);

  const showMentions = filter === "all" || filter === "mention";
  const visibleMentions = showMentions ? mentionRows : [];

  const filteredShared = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "mention") return [];
    return rows.filter((r) => r.resource_type === filter);
  }, [rows, filter]);

  const grouped = useMemo(() => {
    const m = new Map<ResourceType, SharedItemRow[]>();
    for (const r of filteredShared) {
      const arr = m.get(r.resource_type) ?? [];
      arr.push(r);
      m.set(r.resource_type, arr);
    }
    return GROUP_ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, items: m.get(t)! }));
  }, [filteredShared]);

  const totalVisible = filteredShared.length + visibleMentions.length;
  const empty =
    !isLoading && !mentionsLoading && rows.length === 0 && mentionRows.length === 0;
  const emptyForFilter =
    !empty && !isLoading && !mentionsLoading && totalVisible === 0;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-10">
      <header className="mb-6">
        <h1 className="text-2xl font-serif">Shared with me</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Items other people have shared with you, plus work where someone @mentioned you.
        </p>
      </header>

      {!empty && (
        <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Filter shared items by type">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const Icon = f.icon;
            const n = counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{f.label}</span>
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 text-[10px] tabular-nums",
                    active ? "bg-background/20" : "bg-muted",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(isLoading || mentionsLoading) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {empty && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nothing shared with you yet.</p>
        </div>
      )}

      {emptyForFilter && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing here for that filter.</p>
        </div>
      )}

      <div className="space-y-8">
        {visibleMentions.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <AtSign className="h-3.5 w-3.5" /> Mentioned you
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {visibleMentions.map((r) => {
                const Icon = ICONS[r.resource_type];
                return (
                  <li key={r.share_id} className="bg-card">
                    <Link
                      to={LINKS[r.resource_type]}
                      className="flex items-start gap-3 p-3 hover:bg-muted transition-colors"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.title}</div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.subtitle ? `${r.subtitle} · ` : ""}
                          {r.mentioned_by_name ?? "Someone"} mentioned you
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 gap-1">
                        <AtSign className="h-3 w-3" /> mention
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {grouped.map((g) => (
          <section key={g.type}>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {GROUP_LABELS[g.type]}
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {g.items.map((r) => {
                const Icon = ICONS[r.resource_type];
                return (
                  <li key={r.share_id} className="bg-card">
                    <Link
                      to={LINKS[r.resource_type]}
                      className="flex items-start gap-3 p-3 hover:bg-muted transition-colors"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.title}</div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.subtitle ? `${r.subtitle} · ` : ""}
                          Shared by {r.owner_name ?? "Unknown"}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 capitalize">
                        {r.role}
                      </Badge>
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
