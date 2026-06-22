import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, MapPin, ExternalLink, CalendarDays, Clock } from "lucide-react";
import type { EventRow, Calendar as Cal } from "@/lib/calendars";
import type { Business } from "@/lib/businesses";
import { AccountSelector } from "@/components/account-selector";

function isAllDayLike(e: EventRow) {
  if (e.all_day) return true;
  return new Date(e.end_at).getTime() - new Date(e.start_at).getTime() >= 23 * 3600 * 1000;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const URL_RE = /(https?:\/\/[^\s)]+)/i;
function extractJoinUrl(e: EventRow): string | null {
  const loc = e.location?.match(URL_RE)?.[0];
  if (loc) return loc;
  const desc = e.description?.match(URL_RE)?.[0];
  return desc ?? null;
}

export function EventQuickView({
  event,
  cal,
  biz,
  color,
  businesses,
  onChangeAccount,
  onClose,
  onEdit,
  onDelete,
}: {
  event: EventRow | null;
  cal: Cal | null;
  biz: { id: string; name: string; color: string } | null;
  color: string;
  businesses?: Business[];
  /** Persist an event-level account override. Null = Personal / Uncategorised. */
  onChangeAccount?: (id: string | null) => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!event) return null;
  const joinUrl = extractJoinUrl(event);
  const allDay = isAllDayLike(event);
  // Effective account = explicit event override, else inherited from the calendar.
  const effectiveBizId = event.business_id ?? cal?.business_id ?? null;
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
        <div className="p-5 space-y-3">
          <div>
            <h2 className="text-lg font-semibold leading-snug break-words pr-6">
              {event.title}
            </h2>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {fmtDateLong(event.start_at)}
                {" · "}
                {allDay
                  ? "All day"
                  : `${fmtTime(event.start_at)} – ${fmtTime(event.end_at)}`}
              </span>
            </div>
            {cal && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <CalendarDays className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="break-words">{cal.name}</span>
              </div>
            )}
            {event.location && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="break-words">{event.location}</span>
              </div>
            )}
            {joinUrl && (
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> Join meeting
              </a>
            )}
          </div>

          {/* Account override — Heartbeat-only, never written back to Google/Outlook. */}
          {businesses && onChangeAccount && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="text-xs text-muted-foreground">Account</div>
              <AccountSelector
                businesses={businesses}
                value={effectiveBizId}
                onChange={onChangeAccount}
                allowNone
                noneLabel="Personal / Uncategorised"
                size="sm"
              />
            </div>
          )}
          {!onChangeAccount && (
            <div className="text-xs text-muted-foreground">
              {biz ? biz.name : "Personal / Uncategorised"}
            </div>
          )}

          {event.description && (
            <div className="text-sm text-foreground/90 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 leading-snug">
              {event.description}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
