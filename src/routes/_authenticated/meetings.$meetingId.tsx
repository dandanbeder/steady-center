import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listBusinesses } from "@/lib/businesses";
import { listFolders, listLists } from "@/lib/tasks";
import {
  getMeeting,
  listActionItems,
  setActionItemDone,
  linkActionItemTask,
  type ActionItem,
} from "@/lib/meetings";
import { deleteMeetingRecording } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/meetings/$meetingId")({
  component: MeetingDetail,
});

function MeetingDetail() {
  const { meetingId } = Route.useParams();
  const qc = useQueryClient();

  const { data: meeting, isLoading } = useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => getMeeting(meetingId),
  });
  const { data: items = [] } = useQuery({
    queryKey: ["meeting-actions", meetingId],
    queryFn: () => listActionItems(meetingId),
  });
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  const toggleDone = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => setActionItemDone(id, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meeting-actions", meetingId] }),
  });

  const delRecording = useServerFn(deleteMeetingRecording);
  const removeRecording = useMutation({
    mutationFn: () => delRecording({ data: { meeting_id: meetingId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
      toast.success("Recording deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [convertItem, setConvertItem] = useState<ActionItem | null>(null);

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!meeting) return <div className="p-10 text-muted-foreground">Meeting not found.</div>;

  const biz = businesses.find((b) => b.id === meeting.business_id);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
      <Link
        to="/meetings"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to meetings
      </Link>

      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        {biz && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: biz.color }} />
            {biz.name}
          </span>
        )}
        <span>·</span>
        <span>{meeting.platform}</span>
        <span>·</span>
        <span>{new Date(meeting.created_at).toLocaleString()}</span>
      </div>
      <h1 className="text-3xl text-primary mb-4">{meeting.title}</h1>

      {meeting.audio_path && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">Audio recording stored for this meeting.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm("Delete this recording? Transcript and summary stay.")) {
                removeRecording.mutate();
              }
            }}
            disabled={removeRecording.isPending}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" /> Delete recording
          </Button>
        </div>
      )}


      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Summary</h2>
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">
          {meeting.summary || "No summary available."}
        </p>
      </section>

      {meeting.decisions && meeting.decisions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Decisions</h2>
          <ul className="space-y-1.5">
            {meeting.decisions.map((d, i) => (
              <li key={i} className="flex gap-2 text-foreground">
                <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-3">
          Action items
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card"
              >
                <button
                  onClick={() => toggleDone.mutate({ id: it.id, done: !it.done })}
                  className="mt-0.5"
                >
                  <CheckCircle2
                    className={`h-5 w-5 ${
                      it.done ? "text-primary fill-primary/20" : "text-muted-foreground"
                    }`}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className={it.done ? "line-through text-muted-foreground" : "text-foreground"}>
                    {it.text}
                  </p>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                    {it.owner_label && <span>Owner: {it.owner_label}</span>}
                    {it.due_at && <span>Due: {new Date(it.due_at).toLocaleDateString()}</span>}
                    {it.task_id && <span className="text-primary">→ Task created</span>}
                  </div>
                </div>
                {!it.task_id && (
                  <Button size="sm" variant="outline" onClick={() => setConvertItem(it)}>
                    Convert to task
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <details className="border border-border rounded-lg p-4 bg-muted/30">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Full transcript
          </summary>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground/80 font-sans">
            {meeting.transcript}
          </pre>
        </details>
      </section>

      <ConvertDialog
        item={convertItem}
        onClose={() => setConvertItem(null)}
        defaultBusinessId={meeting.business_id}
        onConverted={() => qc.invalidateQueries({ queryKey: ["meeting-actions", meetingId] })}
      />
    </div>
  );
}

function ConvertDialog({
  item,
  onClose,
  defaultBusinessId,
  onConverted,
}: {
  item: ActionItem | null;
  onClose: () => void;
  defaultBusinessId: string | null;
  onConverted: () => void;
}) {
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });

  const [businessId, setBusinessId] = useState<string | null>(defaultBusinessId);
  const [listId, setListId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const availableFolders = folders.filter((f) => !businessId || f.business_id === businessId);
  const availableLists = lists.filter((l) =>
    availableFolders.some((f) => f.id === l.folder_id),
  );

  const convert = async () => {
    if (!item) return;
    if (!listId) {
      toast.error("Pick a list");
      return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          owner_id: u.user.id,
          list_id: listId,
          business_id: businessId,
          title: item.text,
          due_at: item.due_at,
          status: "todo",
          priority: "normal",
        })
        .select("id")
        .single();
      if (error || !task) throw new Error(error?.message ?? "Failed to create task");
      await linkActionItemTask(item.id, task.id);
      toast.success("Task created");
      onConverted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to convert");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to task</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">{item.text}</p>
            <div>
              <Label>Business</Label>
              <Select
                value={businessId ?? "_none"}
                onValueChange={(v) => {
                  setBusinessId(v === "_none" ? null : v);
                  setListId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No business</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>List</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a list" />
                </SelectTrigger>
                <SelectContent>
                  {availableLists.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No lists. Create one in Tasks.
                    </div>
                  ) : (
                    availableLists.map((l) => {
                      const folder = folders.find((f) => f.id === l.folder_id);
                      return (
                        <SelectItem key={l.id} value={l.id}>
                          {folder?.name} / {l.name}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={convert} disabled={busy} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
