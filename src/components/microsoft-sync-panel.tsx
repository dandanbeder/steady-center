import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Calendar as CalendarIcon, Link as LinkIcon, AlertTriangle, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getMicrosoftStatus,
  startMicrosoftOAuth,
  listRemoteMicrosoftCalendars,
  importMicrosoftCalendar,
  syncMicrosoftCalendarNow,
  disconnectMicrosoft,
} from "@/lib/microsoft-calendar.functions";
import { listCalendars } from "@/lib/calendars";
import { Button } from "@/components/ui/button";
import { setCalendarBusiness, type Business } from "@/lib/businesses";
import { AccountSelector } from "@/components/account-selector";

type Props = { businesses: Business[] };

export function MicrosoftSyncPanel({ businesses }: Props) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMicrosoftStatus);
  const startFn = useServerFn(startMicrosoftOAuth);
  const listRemote = useServerFn(listRemoteMicrosoftCalendars);
  const importFn = useServerFn(importMicrosoftCalendar);
  const syncFn = useServerFn(syncMicrosoftCalendarNow);
  const disconnectFn = useServerFn(disconnectMicrosoft);

  const [open, setOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");

  const status = useQuery({
    queryKey: ["microsoft-status"],
    queryFn: () => statusFn(),
  });

  const localCals = useQuery({
    queryKey: ["calendars"],
    queryFn: listCalendars,
  });
  const synced = (localCals.data ?? []).filter((c) => c.provider === "microsoft");

  const remote = useQuery({
    queryKey: ["microsoft-calendars-remote"],
    queryFn: () => listRemote(),
    enabled: open && !!status.data?.connected && !status.data?.needs_reconnect,
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

  const disconnectMut = useMutation({
    mutationFn: (remove_events: boolean) => disconnectFn({ data: { remove_events } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["microsoft-status"] });
      qc.invalidateQueries({ queryKey: ["calendars"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Microsoft disconnected");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
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

  async function connect() {
    try {
      const { authorize_url } = await startFn({ data: { origin: window.location.origin } });
      // Open in a popup; the callback page closes itself and posts a message.
      const w = window.open(authorize_url, "ms-oauth", "width=520,height=720");
      if (!w) {
        // Pop-up blocked — fall back to full redirect
        window.location.href = authorize_url;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start Microsoft sign-in");
    }
  }

  // Listen for the callback popup to tell us it's done.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.data?.type === "ms-oauth:complete") {
        qc.invalidateQueries({ queryKey: ["microsoft-status"] });
        toast.success("Microsoft connected");
      } else if (ev.data?.type === "ms-oauth:error") {
        toast.error(`Microsoft sign-in failed: ${ev.data.error ?? "unknown"}`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  const connected = !!status.data?.connected;
  const needsReconnect = !!status.data?.needs_reconnect;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Microsoft / Outlook Calendar
          </h3>
          <p className="text-xs text-muted-foreground">
            Two-way sync via Microsoft Graph. Works with personal and work/school accounts.
          </p>
          {connected && status.data?.account_email && (
            <p className="text-xs text-muted-foreground mt-1">
              Connected as <span className="font-medium">{status.data.account_email}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
                <LinkIcon className="h-3.5 w-3.5 mr-1" />
                {open ? "Close" : "Import calendars"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disconnectMut.isPending}
                onClick={() => {
                  if (confirm("Disconnect Microsoft? Existing synced events will remain. Click Cancel to also remove synced events.")) {
                    disconnectMut.mutate(false);
                  } else {
                    if (confirm("Also remove synced Microsoft calendars and events from Heartbeat?")) {
                      disconnectMut.mutate(true);
                    }
                  }
                }}
              >
                <Unplug className="h-3.5 w-3.5 mr-1" /> Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={connect}>Connect Outlook</Button>
          )}
        </div>
      </div>

      {needsReconnect && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Microsoft connection expired or was revoked. <Button size="sm" variant="link" className="px-1" onClick={connect}>Reconnect</Button>
        </div>
      )}

      {synced.length > 0 && (
        <div className="space-y-1.5">
          {synced.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="truncate">{c.name}</span>
                {c.last_synced_at && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    · synced {new Date(c.last_synced_at).toLocaleString()}
                  </span>
                )}
              </div>
              <AccountSelector
                businesses={businesses}
                value={c.business_id}
                onChange={(business_id) => remapMut.mutate({ calendar_id: c.id, business_id })}
                size="sm"
                noneLabel="No account"
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
            </div>
          ))}
        </div>
      )}

      {open && connected && !needsReconnect && (
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="block text-sm space-y-1">
            <span>Tag newly imported calendars to account:</span>
            <AccountSelector
              businesses={businesses}
              value={selectedBusiness || null}
              onChange={(id) => setSelectedBusiness(id ?? "")}
              noneLabel="No account"
              className="w-full"
            />
          </div>

          {remote.isLoading && <p className="text-sm text-muted-foreground">Loading from Microsoft…</p>}
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
              const alreadyImported = synced.some((s) => s.external_id === c.id);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: c.color }} />
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
