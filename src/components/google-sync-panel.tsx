import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Calendar as CalendarIcon, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  listRemoteGoogleCalendars,
  importGoogleCalendar,
  syncGoogleCalendarNow,
} from "@/lib/google-calendar.functions";
import { listCalendars } from "@/lib/calendars";
import { Button } from "@/components/ui/button";
import type { Business } from "@/lib/businesses";

type Props = { businesses: Business[] };

export function GoogleSyncPanel({ businesses }: Props) {
  const qc = useQueryClient();
  const listRemote = useServerFn(listRemoteGoogleCalendars);
  const importFn = useServerFn(importGoogleCalendar);
  const syncFn = useServerFn(syncGoogleCalendarNow);

  const [open, setOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");

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
          business_id: selectedBusiness || null,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Google Calendar
          </h3>
          <p className="text-xs text-muted-foreground">
            Two-way sync. Events tagged with the business you import them into.
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
              className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: c.color }}
                />
                <span>{c.name}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={syncMut.isPending}
                onClick={() => syncMut.mutate(c.id)}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
                Sync now
              </Button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <label className="block text-sm">
            Tag imported calendars to business:
            <select
              value={selectedBusiness}
              onChange={(e) => setSelectedBusiness(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— No business —</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>

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
    </div>
  );
}
