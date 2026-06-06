import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Trash2, RotateCcw, AlertTriangle, FileText, CheckSquare, Calendar, FolderOpen, List as ListIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  listTrash,
  restoreItem,
  hardDeleteItem,
  emptyTrash,
  daysUntilPurge,
  type TrashKind,
  type TrashRow,
} from "@/lib/trash";

export const Route = createFileRoute("/_authenticated/trash")({
  component: TrashPage,
  head: () => ({
    meta: [
      { title: "Trash — Heartbeat" },
      { name: "description", content: "Restore or permanently delete items you removed in the last 30 days." },
    ],
  }),
});

const KIND_LABEL: Record<TrashKind, string> = {
  task: "Tasks",
  note: "Notes",
  event: "Events",
  list: "Lists",
  folder: "Folders",
};

const KIND_ICON: Record<TrashKind, typeof FileText> = {
  task: CheckSquare,
  note: FileText,
  event: Calendar,
  list: ListIcon,
  folder: FolderOpen,
};

function TrashPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TrashKind | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: listTrash,
  });

  const grouped = useMemo(() => {
    const out: Record<TrashKind, TrashRow[]> = { task: [], note: [], event: [], list: [], folder: [] };
    for (const row of data ?? []) out[row.kind].push(row);
    return out;
  }, [data]);

  const total = data?.length ?? 0;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["lists"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };

  const restore = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) => restoreItem(kind, id),
    onSuccess: (res) => {
      invalidateAll();
      if (res.syncWarning) toast.warning(res.syncWarning);
      else toast.success("Restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Restore failed"),
  });

  const hardDelete = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) => hardDeleteItem(kind, id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Permanently deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const empty = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      invalidateAll();
      toast.success("Trash emptied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to empty trash"),
  });

  const rowsToShow: TrashRow[] = tab === "all" ? (data ?? []) : grouped[tab];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-10 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Items here are permanently deleted after 30 days.
            </p>
          </div>
          {total > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Empty trash
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Empty trash?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {total} item{total === 1 ? "" : "s"}. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => empty.mutate()}>
                    Empty trash
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TrashKind | "all")}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">
              All <Badge variant="secondary" className="ml-2">{total}</Badge>
            </TabsTrigger>
            {(["task", "note", "event", "list", "folder"] as TrashKind[]).map((k) => (
              <TabsTrigger key={k} value={k}>
                {KIND_LABEL[k]} <Badge variant="secondary" className="ml-2">{grouped[k].length}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {isLoading ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
            ) : rowsToShow.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  Nothing in Trash.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{rowsToShow.length} item{rowsToShow.length === 1 ? "" : "s"}</CardTitle>
                  <CardDescription>Restore brings an item (and any children) back. Delete forever is permanent.</CardDescription>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                  {rowsToShow.map((row) => {
                    const Icon = KIND_ICON[row.kind];
                    const days = daysUntilPurge(row.deleted_at);
                    return (
                      <div key={`${row.kind}-${row.id}`} className="flex items-center gap-3 px-4 py-3">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{row.title || `Untitled ${row.kind}`}</div>
                          <div className="text-xs text-muted-foreground">
                            {KIND_LABEL[row.kind].slice(0, -1)} · deleted {formatDistanceToNow(new Date(row.deleted_at), { addSuffix: true })} · purges in {days} day{days === 1 ? "" : "s"}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => restore.mutate({ kind: row.kind, id: row.id })}
                          disabled={restore.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete forever
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete forever?</AlertDialogTitle>
                              <AlertDialogDescription>
                                "{row.title || `Untitled ${row.kind}`}" will be permanently removed. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => hardDelete.mutate({ kind: row.kind, id: row.id })}>
                                Delete forever
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
