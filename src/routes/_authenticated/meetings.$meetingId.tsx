import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, ExternalLink, Loader2, Share2, Sparkles, Trash2, Users, Video } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import { detectPlatformFromUrl, platformInfoFromId } from "@/lib/meeting-platform";
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
import { listOutcomes, type Outcome } from "@/lib/outcomes";
import { listFolders, listLists } from "@/lib/tasks";
import {
  getMeeting,
  listActionItems,
  listMeetingDecisions,
  setActionItemDone,
  linkActionItemTask,
  type ActionItem,
} from "@/lib/meetings";
import { generateMeetingDraft, applyMeetingDraft } from "@/lib/meetings.functions";
import { deleteMeetingRecording } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { ActivityAndComments } from "@/components/comments/activity-and-comments";
import { AIDraftDialog, newDraftFrom, type AIDraft } from "@/components/meetings/ai-draft-dialog";
import { MeetingNotesPanel } from "@/components/meetings/meeting-notes-panel";


import { UpgradeGate } from "@/components/upgrade-gate";

export const Route = createFileRoute("/_authenticated/meetings/$meetingId")({
  component: () => (
    <UpgradeGate feature="meetings">
      <MeetingDetail />
    </UpgradeGate>
  ),
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
  const { data: decisions = [] } = useQuery({
    queryKey: ["meeting-decisions", meetingId],
    queryFn: () => listMeetingDecisions(meetingId),
  });
  const { data: outcomes = [] } = useQuery({
    queryKey: ["outcomes-for-meeting"],
    queryFn: () => listOutcomes(null),
  });
  const outcomeById = new Map<string, Outcome>(outcomes.map((o) => [o.id, o]));

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

  // User-invoked AI workflow.
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<AIDraft | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const generate = useServerFn(generateMeetingDraft);
  const apply = useServerFn(applyMeetingDraft);
  const generateMut = useMutation({
    mutationFn: () => generate({ data: { meeting_id: meetingId } }),
    onSuccess: (res) => {
      setDraft(newDraftFrom(res, meeting?.business_id ?? null));
      setConfirmRunOpen(false);
      setDraftOpen(true);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "AI failed";
      if (/credit|402/i.test(msg)) {
        toast.error("Out of AI credits. Add credits in Workspace settings.");
      } else if (/rate|429/i.test(msg)) {
        toast.error("Rate limited. Try again shortly.");
      } else {
        toast.error(msg);
      }
    },
  });
  const applyMut = useMutation({
    mutationFn: (d: AIDraft) =>
      apply({
        data: {
          meeting_id: meetingId,
          summary: d.summary,
          decisions: d.decisions.filter((x) => x.text.trim()),
          tasks: d.tasks
            .filter((t) => t.accepted && t.text.trim())
            .map((t) => ({
              text: t.text,
              owner_label: t.owner_label,
              due_at: t.due_at,
              business_id: t.business_id,
              list_id: t.list_id,
              outcome_id: t.outcome_id,
            })),
        },
      }),
    onSuccess: (res) => {
      toast.success(`Saved. Created ${res.created_count} task${res.created_count === 1 ? "" : "s"}.`);
      setDraftOpen(false);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
      qc.invalidateQueries({ queryKey: ["meeting-actions", meetingId] });
      qc.invalidateQueries({ queryKey: ["meeting-decisions", meetingId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });


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
        {(() => {
          const info = meeting.join_url
            ? detectPlatformFromUrl(meeting.join_url)
            : platformInfoFromId(meeting.platform);
          const Icon = info.icon === "video" ? Video : Users;
          return (
            <span className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" /> {info.label}
            </span>
          );
        })()}
        <span>·</span>
        <span>
          {meeting.scheduled_at
            ? new Date(meeting.scheduled_at).toLocaleString()
            : new Date(meeting.created_at).toLocaleString()}
        </span>
      </div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-3xl text-primary">{meeting.title}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {meeting.join_url && (
            <a
              href={meeting.join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Video className="h-4 w-4" /> Join
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          )}
          <Button size="sm" variant="outline" onClick={() => setShareOpen(true)} className="gap-2">
            <Share2 className="h-4 w-4" /> Share
          </Button>
        </div>
      </div>

      {meeting.attendees && meeting.attendees.length > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Attendees</p>
          <p className="text-sm text-foreground">
            {meeting.attendees
              .map((a) => a.name || a.email)
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
      )}

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
      {/* User-invoked AI: heavy action, metered, with confirmation. */}
      {(meeting.transcript || meeting.audio_path) && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm text-foreground font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI summary &amp; action items
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Turn this {meeting.audio_path && !meeting.transcript ? "recording" : "transcript"} into a summary,
              decisions, and suggested tasks. You review and confirm before anything is created.
            </p>
          </div>
          <Button
            onClick={() => setConfirmRunOpen(true)}
            disabled={generateMut.isPending}
            className="gap-2"
          >
            {generateMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {meeting.summary ? "Re-generate" : "Generate with AI"}
          </Button>
        </div>
      )}

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Summary</h2>
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">
          {meeting.summary || "No summary yet."}
        </p>
      </section>

      {decisions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Decisions</h2>
          <ul className="space-y-1.5">
            {decisions.map((d) => (
              <li key={d.id} className="flex gap-2 text-foreground">
                <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="flex-1">
                  {d.text}
                  {d.outcome_id && (
                    <Link
                      to="/outcomes"
                      className="ml-2 text-xs text-primary hover:underline"
                    >
                      → {outcomeById.get(d.outcome_id)?.name ?? "linked outcome"}
                    </Link>
                  )}
                </span>
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

      <MeetingNotesPanel meeting={meeting} />

      <section>
        <ActivityAndComments
          parentType="meeting"
          parentId={meeting.id}
          businessId={meeting.business_id}
        />
      </section>


      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        resourceType="meeting"
        resourceId={meeting.id}
        resourceName={meeting.title}
      />

      <ConvertDialog
        item={convertItem}
        onClose={() => setConvertItem(null)}
        defaultBusinessId={meeting.business_id}
        onConverted={() => qc.invalidateQueries({ queryKey: ["meeting-actions", meetingId] })}
      />

      {/* Cost confirmation before invoking AI. */}
      <Dialog open={confirmRunOpen} onOpenChange={(v) => !generateMut.isPending && setConfirmRunOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate with AI?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-foreground">
            <p>
              This is a heavy AI action: it{" "}
              {meeting.audio_path && !meeting.transcript ? "transcribes the recording, then " : ""}
              writes a summary, extracts decisions, and suggests action items.
            </p>
            <p className="text-muted-foreground">
              <strong>Estimated cost:</strong> ~10 AI credits
              {meeting.audio_path && !meeting.transcript ? " (plus transcription)" : ""}.
            </p>
            <p className="text-muted-foreground">
              You'll review and edit everything before any tasks or decisions are saved.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRunOpen(false)} disabled={generateMut.isPending}>
              Cancel
            </Button>
            <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending} className="gap-2">
              {generateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Run AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AIDraftDialog
        open={draftOpen}
        onOpenChange={(v) => {
          if (!applyMut.isPending) {
            setDraftOpen(v);
            if (!v) setDraft(null);
          }
        }}
        draft={draft}
        setDraft={setDraft}
        defaultBusinessId={meeting.business_id}
        busy={applyMut.isPending}
        onConfirm={() => draft && applyMut.mutate(draft)}
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
              <Label>Account</Label>
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
                  <SelectItem value="_none">No account</SelectItem>
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
