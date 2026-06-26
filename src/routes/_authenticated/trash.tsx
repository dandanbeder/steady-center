import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  FileText,
  CheckSquare,
  Calendar,
  FolderOpen,
  List as ListIcon,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
      { title: "Trash, Heartbeat" },
      {
        name: "description",
        content:
          "Restore or permanently delete items you removed in the last 30 days.",
      },
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

function rowKey(r: TrashRow) {
  return `${r.kind}:${r.id}`;
}

function TrashPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TrashKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: listTrash,
  });

  const grouped = useMemo(() => {
    const out: Record<TrashKind, TrashRow[]> = {
      task: [],
      note: [],
      event: [],
      list: [],
      folder: [],
    };
    for (const row of data ?? []) out[row.kind].push(row);
    return out;
  }, [data]);

  const total = data?.length ?? 0;
  const rowsToShow: TrashRow[] = tab === "all" ? (data ?? []) : grouped[tab];

  const allVisibleSelected =
    rowsToShow.length > 0 && rowsToShow.every((r) => selected.has(rowKey(r)));
  const someSelected = selected.size > 0;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["lists"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };

  const restore = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) =>
      restoreItem(kind, id),
    onSuccess: (res) => {
      invalidateAll();
      if (res.syncWarning) toast.warning(res.syncWarning);
      else toast.success("Restored to its original spot");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Restore failed"),
  });

  const hardDelete = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) =>
      hardDeleteItem(kind, id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Permanently deleted");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const empty = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      setSelected(new Set());
      invalidateAll();
      toast.success("Trash emptied");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to empty trash"),
  });

  const bulkRestore = useMutation({
    mutationFn: async () => {
      const picks = (data ?? []).filter((r) => selected.has(rowKey(r)));
      let ok = 0;
      let warn = 0;
      for (const r of picks) {
        try {
          const res = await restoreItem(r.kind, r.id);
          if (res.syncWarning) warn++;
          ok++;
        } catch {
          /* ignore individual failures */
        }
      }
      return { ok, warn, total: picks.length };
    },
    onSuccess: ({ ok, warn, total: t }) => {
      setSelected(new Set());
      invalidateAll();
      if (ok === 0) toast.error("Nothing could be restored");
      else if (warn > 0)
        toast.warning(`Restored ${ok} of ${t}, ${warn} need a re-sync`);
      else toast.success(`Restored ${ok} item${ok === 1 ? "" : "s"}`);
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const picks = (data ?? []).filter((r) => selected.has(rowKey(r)));
      let ok = 0;
      for (const r of picks) {
        try {
          await hardDeleteItem(r.kind, r.id);
          ok++;
        } catch {
          /* ignore */
        }
      }
      return { ok, total: picks.length };
    },
    onSuccess: ({ ok, total: t }) => {
      setSelected(new Set());
      invalidateAll();
      if (ok === 0) toast.error("Nothing could be deleted");
      else toast.success(`Permanently deleted ${ok} of ${t}`);
    },
  });

  const toggle = (k: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of rowsToShow) next.delete(rowKey(r));
      } else {
        for (const r of rowsToShow) next.add(rowKey(r));
      }
      return next;
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-10 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A safety net for deleted tasks, notes, events, lists, and folders.
            Items here are permanently removed after 30 days.
          </p>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Journal entries never come here, they stay in your private Journal.
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
                  This permanently deletes {total} item
                  {total === 1 ? "" : "s"}. This can't be undone.
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

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TrashKind | "all");
        }}
      >
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">
            All{" "}
            <Badge variant="secondary" className="ml-2">
              {total}
            </Badge>
          </TabsTrigger>
          {(["task", "note", "event", "list", "folder"] as TrashKind[]).map(
            (k) => (
              <TabsTrigger key={k} value={k}>
                {KIND_LABEL[k]}{" "}
                <Badge variant="secondary" className="ml-2">
                  {grouped[k].length}
                </Badge>
              </TabsTrigger>
            ),
          )}
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading…
              </CardContent>
            </Card>
          ) : rowsToShow.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                Nothing in Trash.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {rowsToShow.length} item
                    {rowsToShow.length === 1 ? "" : "s"}
                  </CardTitle>
                  <CardDescription>
                    Restore brings an item (and any children) back to its
                    original place. Delete forever is permanent.
                  </CardDescription>
                </div>
                {someSelected && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {selected.size} selected
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => bulkRestore.mutate()}
                      disabled={bulkRestore.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restore
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete forever
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {selected.size} item
                            {selected.size === 1 ? "" : "s"} forever?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This can't be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => bulkDelete.mutate()}
                          >
                            Delete forever
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={toggleAllVisible}
                    aria-label="Select all"
                  />
                  <span className="text-xs text-muted-foreground">
                    Select all visible
                  </span>
                </div>
                <div className="divide-y">
                  {rowsToShow.map((row) => {
                    const Icon = KIND_ICON[row.kind];
                    const days = daysUntilPurge(row.deleted_at);
                    const k = rowKey(row);
                    const checked = selected.has(k);
                    const isFolder = row.kind === "folder";
                    return (
                      <div
                        key={k}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            toggle(k);
                          }}
                          aria-label={`Select ${row.title || row.kind}`}
                        />
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {row.title || `Untitled ${row.kind}`}
                            {isFolder && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[10px] font-normal"
                              >
                                folder + contents
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {KIND_LABEL[row.kind].slice(0, -1)} · deleted{" "}
                            {formatDistanceToNow(new Date(row.deleted_at), {
                              addSuffix: true,
                            })}
                            {row.deleted_by_name
                              ? ` by ${row.deleted_by_name}`
                              : ""}{" "}
                            · {days} day{days === 1 ? "" : "s"} left
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            restore.mutate({ kind: row.kind, id: row.id })
                          }
                          disabled={restore.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete forever
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete forever?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                "{row.title || `Untitled ${row.kind}`}" will be
                                permanently removed. This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  hardDelete.mutate({
                                    kind: row.kind,
                                    id: row.id,
                                  })
                                }
                              >
                                Delete forever
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
