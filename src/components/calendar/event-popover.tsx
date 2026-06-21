import { type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, MapPin, ExternalLink, CalendarDays, Clock } from "lucide-react";
import type { EventRow, Calendar as Cal } from "@/lib/calendars";

function isAllDayLike(e: EventRow) {
  if (e.all_day) return true;
  return new Date(e.end_at).getTime() - new Date(e.start_at).getTime() >= 23 * 3600 * 1000;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
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

export function EventPopover({
  event,
  cal,
  biz,
  color,
  onEdit,
  onDelete,
  children,
}: {
  event: EventRow;
  cal: Cal | undefined;
  biz: { id: string; name: string; color: string } | null;
  color: string;
  onEdit: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const joinUrl = extractJoinUrl(event);
  const allDay = isAllDayLike(event);
  return (
    <TooltipProvider delayDuration={400}>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="font-medium">{event.title}</div>
            <div className="opacity-80 text-[10px]">
              {allDay ? "All day" : `${fmtTime(event.start_at)} – ${fmtTime(event.end_at)}`}
            </div>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80 p-0 overflow-hidden" align="start">
          <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
          <div className="p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold leading-snug break-words">
                {event.title}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3 shrink-0" />
                <span>
                  {fmtDateLong(event.start_at)}
                  {" · "}
                  {allDay ? "All day" : `${fmtTime(event.start_at)} – ${fmtTime(event.end_at)}`}
                </span>
              </div>
              {(cal || biz) && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {cal?.name ?? "Calendar"}
                    {biz ? ` · ${biz.name}` : ""}
                  </span>
                </div>
              )}
              {event.location && (
                <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="break-words">{event.location}</span>
                </div>
              )}
            </div>

            {joinUrl && (
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Join meeting
              </a>
            )}

            {event.description && (
              <div className="text-xs text-foreground/80 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 leading-snug">
                {event.description}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
              <Button size="sm" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
