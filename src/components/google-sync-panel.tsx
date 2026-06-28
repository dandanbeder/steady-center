import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Calendar as CalendarIcon, Link as LinkIcon, MoreVertical, Unplug, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  listRemoteGoogleCalendars,
  importGoogleCalendar,
  syncGoogleCalendarNow,
  disconnectGoogleCalendar,
} from "@/lib/google-calendar.functions";
import { listCalendars } from "@/lib/calendars";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setCalendarBusiness, type Business } from "@/lib/businesses";
import { CalendarAccountPicker } from "@/components/calendar-account-picker";
import { DisconnectCalendarDialog } from "@/components/disconnect-calendar-dialog";

type Props = { businesses: Business[] };

export function GoogleSyncPanel({ businesses }: Props) {
  const qc = useQueryClient();
  const listRemote = useServerFn(listRemoteGoogleCalendars);
  const importFn = useServerFn(importGoogleCalendar);
  const syncFn = useServerFn(syncGoogleCalendarNow);
  const disconnectFn = useServerFn(disconnectGoogleCalendar);

  const [open, setOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);

  const localCals = useQuery({
    queryKey: ["calendars"],
    queryFn: listCalendars,
  });
  const syncedGoogleCals = (localCals.data ?? []).filter((c) => c.provider === "google");

  const remote = useQuery({
    queryKey: ["google-calendars-remote"],
    queryFn: () => listRemote(),
    enabled: open,
    retry: false,
  });

  const importMut = useMutation({
    mutationFn: (args: { external_id: string; name: string; color: string }) =>
      importFn({
        data: {
          external_id: args.external_id,
          name: args.name,
          color: args.color,
          business_id: selectedBusiness,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["calendars"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(r.alreadyImported ? "Already imported" : "Calendar imported");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const syncMut = useMutation({
    mutationFn: (calendar_id: string) => syncFn({ data: { calendar_id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Synced: +${r.inserted} new, ${r.updated} updated, ${r.deleted} removed`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const disconnectMut = useMutation({
    mutationFn: (args: { calendar_id: string; remove_events: boolean }) =>
      disconnectFn({ data: args }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["calendars"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["google-calendars-remote"] });
      setDisconnectTarget(null);
      toast.success(r.removed_events ? "Disconnected and events removed" : "Disconnected");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to disconnect"),
  });

  const remapMut = useMutation({
    mutationFn: ({ calendar_id, business_id }: { calendar_id: string; business_id: string | null }) =>
      setCalendarBusiness(calendar_id, business_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendars"] });
      toast.success("Account updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Google Calendar
          </h3>
          <p className="text-xs text-muted-foreground">
            Two-way sync. Events tagged with the account you import them into.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <LinkIcon className="h-3.5 w-3.5 mr-1" />
          {open ? "Close" : "Import calendars"}
        </Button>
      </div>

      {syncedGoogleCals.length > 0 && (
        <div className="space-y-1.5">
          {syncedGoogleCals.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span
                  className="inline-block h-3 w-3 rounded-full shrink-0"
                  style={{ background: c.color }}
                />
                <span className="truncate">{c.name}</span>
                {c.last_synced_at && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    · synced {new Date(c.last_synced_at).toLocaleString()}
                  </span>
                )}
              </div>
              <CalendarAccountPicker
                businesses={businesses}
                value={c.business_id}
                onChange={(business_id) => remapMut.mutate({ calendar_id: c.id, business_id })}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={syncMut.isPending}
                onClick={() => syncMut.mutate(c.id)}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
                Sync now
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => syncMut.mutate(c.id)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-2" /> Sync now
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDisconnectTarget({ id: c.id, name: c.name })}
                  >
                    <Unplug className="h-3.5 w-3.5 mr-2" /> Disconnect…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="block text-sm space-y-1">
            <span>Tag newly imported calendars to account:</span>
            <CalendarAccountPicker
              businesses={businesses}
              value={selectedBusiness}
              onChange={(id) => setSelectedBusiness(id)}
            />
          </div>

          {remote.isLoading && <p className="text-sm text-muted-foreground">Loading from Google…</p>}
          {remote.isError && (
            <p className="text-sm text-destructive">
              {remote.error instanceof Error ? remote.error.message : "Failed to load"}
            </p>
          )}
          {remote.data && remote.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No writable calendars found.</p>
          )}

          <ul className="space-y-1.5">
            {(remote.data ?? []).map((c) => {
              const alreadyImported = syncedGoogleCals.some((s) => s.external_id === c.id);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span>{c.name}{c.primary && " (primary)"}</span>
                  </div>
                  <Button
                    size="sm"
                    variant={alreadyImported ? "ghost" : "outline"}
                    disabled={alreadyImported || importMut.isPending}
                    onClick={() => importMut.mutate({ external_id: c.id, name: c.name, color: c.color })}
                  >
                    {alreadyImported ? "Imported" : "Import"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {disconnectTarget && (
        <DisconnectCalendarDialog
          open={!!disconnectTarget}
          onOpenChange={(o) => !o && setDisconnectTarget(null)}
          provider="Google"
          calendarName={disconnectTarget.name}
          busy={disconnectMut.isPending}
          onConfirm={() =>
            disconnectMut.mutate({ calendar_id: disconnectTarget.id, remove_events: false })
          }
        />
      )}
    </div>
  );
}
