import { Megaphone, AlertTriangle, AlertOctagon } from "lucide-react";
import { useAnnouncements } from "@/hooks/use-app-control";

export function AnnouncementBanner() {
  const { data = [] } = useAnnouncements();
  if (data.length === 0) return null;
  return (
    <div>
      {data.map((a) => {
        const Icon =
          a.level === "critical" ? AlertOctagon : a.level === "warning" ? AlertTriangle : Megaphone;
        const cls =
          a.level === "critical"
            ? "bg-destructive text-destructive-foreground"
            : a.level === "warning"
              ? "bg-amber-500/20 text-amber-900 dark:text-amber-200"
              : "bg-primary/10 text-foreground";
        return (
          <div key={a.id} className={`flex items-start gap-3 px-4 py-2 text-sm border-b ${cls}`}>
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">{a.title}</div>
              {a.body && <div className="opacity-80 text-xs whitespace-pre-wrap">{a.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
