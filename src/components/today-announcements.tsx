import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Wrench, Sparkles, Megaphone, X } from "lucide-react";
import {
  listActiveAnnouncementsForMe,
  listMyDismissals,
  dismissAnnouncement,
  type AnnouncementKind,
} from "@/lib/announcements";

function iconFor(kind: AnnouncementKind) {
  switch (kind) {
    case "maintenance": return Wrench;
    case "feature":     return Sparkles;
    case "update":      return Megaphone;
    default:            return Info;
  }
}

function labelFor(kind: AnnouncementKind) {
  switch (kind) {
    case "maintenance": return "Maintenance";
    case "feature":     return "New feature";
    case "update":      return "Update";
    default:            return "Notice";
  }
}

export function TodayAnnouncements() {
  const qc = useQueryClient();
  const annsQ = useQuery({
    queryKey: ["announcements", "active-mine"],
    queryFn: listActiveAnnouncementsForMe,
    staleTime: 60_000,
  });
  const dismQ = useQuery({
    queryKey: ["announcements", "dismissals-mine"],
    queryFn: listMyDismissals,
    staleTime: 60_000,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissAnnouncement(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["announcements", "dismissals-mine"] });
      const prev = qc.getQueryData<Set<string>>(["announcements", "dismissals-mine"]) ?? new Set();
      const next = new Set(prev);
      next.add(id);
      qc.setQueryData(["announcements", "dismissals-mine"], next);
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["announcements", "dismissals-mine"], ctx.prev);
    },
  });

  const dismissed = dismQ.data ?? new Set<string>();
  const visible = (annsQ.data ?? []).filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mt-6 space-y-2" aria-label="Announcements">
      {visible.map((a) => {
        const Icon = iconFor(a.kind);
        return (
          <div
            key={a.id}
            className="group flex items-start gap-3 rounded-xl border border-border bg-card/60 px-4 py-3"
            style={{ boxShadow: "var(--shadow-soft)" }}
            role="status"
          >
            <Icon className="h-4 w-4 mt-0.5 text-accent shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {labelFor(a.kind)}
                </span>
              </div>
              <div className="text-sm font-medium text-foreground mt-0.5">{a.title}</div>
              {a.body && (
                <div className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
                  {a.body}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate(a.id)}
              className="text-muted-foreground/60 hover:text-foreground transition rounded p-1"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
