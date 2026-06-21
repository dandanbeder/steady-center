import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Upload, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { listMeetings, deleteMeeting, uploadMeetingAudio } from "@/lib/meetings";
import { processMeeting } from "@/lib/meetings.functions";
import { UpcomingMeetings } from "@/components/upcoming-meetings";
import { UpgradeGate } from "@/components/upgrade-gate";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: () => (
    <UpgradeGate feature="meetings">
      <MeetingsPage />
    </UpgradeGate>
  ),
});

function MeetingsPage() {
  const { activeId } = useActiveBusiness();
  const businessFilter = activeId === ALL ? null : activeId;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings", businessFilter],
    queryFn: () => listMeetings(businessFilter),
  });

  const del = useMutation({
    mutationFn: deleteMeeting,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Meeting deleted");
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary">Meetings</h1>
          <p className="mt-2 text-muted-foreground">
            {activeId === ALL ? "Across all accounts" : "Filtered to active account"}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New meeting note
        </Button>
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-soft)" }}>
        <h2 className="text-lg mb-3">Upcoming meetings</h2>
        <UpcomingMeetings horizonDays={14} limit={8} />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground">
          No meetings yet. Start by adding one.
        </div>
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => {
            const biz = businesses.find((b) => b.id === m.business_id);
            return (
              <li
                key={m.id}
                className="border border-border rounded-xl p-5 hover:border-primary/40 transition-colors bg-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <Link
                    to="/meetings/$meetingId"
                    params={{ meetingId: m.id }}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      {biz && (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: biz.color }}
                          />
                          {biz.name}
                        </span>
                      )}
                      <span>·</span>
                      <span>{m.platform}</span>
                      <span>·</span>
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <h3 className="text-lg text-foreground font-medium truncate">{m.title}</h3>
                    {m.summary && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{m.summary}</p>
                    )}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Delete this meeting?")) del.mutate(m.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NewMeetingDialog open={open} onOpenChange={setOpen} defaultBusinessId={businessFilter} />
    </div>
  );
}

function NewMeetingDialog({
  open,
  onOpenChange,
  defaultBusinessId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBusinessId: string | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const process = useServerFn(processMeeting);
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("other");
  const [businessId, setBusinessId] = useState<string | null>(defaultBusinessId);
  const [mode, setMode] = useState<"paste" | "audio">("paste");
  const [transcript, setTranscript] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [keepRecording, setKeepRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setPlatform("other");
    setBusinessId(defaultBusinessId);
    setMode("paste");
    setTranscript("");
    setAudioFile(null);
    setKeepRecording(false);
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Add a title");
      return;
    }
    if (mode === "paste" && !transcript.trim()) {
      toast.error("Paste a transcript");
      return;
    }
    if (mode === "audio" && !audioFile) {
      toast.error("Choose an audio file");
      return;
    }
    setBusy(true);
    try {
      let audio_path: string | undefined;
      if (mode === "audio" && audioFile) {
        toast.info("Uploading audio…");
        audio_path = await uploadMeetingAudio(audioFile);
        toast.info("Transcribing and summarizing…");
      } else {
        toast.info("Summarizing…");
      }
      const res = await process({
        data: {
          title: title.trim(),
          platform,
          business_id: businessId,
          transcript: mode === "paste" ? transcript.trim() : undefined,
          audio_path,
          keep_recording: mode === "audio" ? keepRecording : false,
        },
      });
      toast.success("Meeting saved");
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onOpenChange(false);
      reset();
      navigate({ to: "/meetings/$meetingId", params: { meetingId: res.meeting_id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to process meeting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New meeting note</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Acme pricing call"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Account</Label>
              <Select
                value={businessId ?? "_none"}
                onValueChange={(v) => setBusinessId(v === "_none" ? null : v)}
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
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zoom">Zoom</SelectItem>
                  <SelectItem value="meet">Google Meet</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                  <SelectItem value="in_person">In person</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as "paste" | "audio")}>
            <TabsList>
              <TabsTrigger value="paste">Paste transcript</TabsTrigger>
              <TabsTrigger value="audio">Upload audio</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="mt-3">
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the meeting transcript…"
                className="min-h-[200px]"
              />
            </TabsContent>
            <TabsContent value="audio" className="mt-3 space-y-3">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/40">
                <Upload className="h-6 w-6 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {audioFile ? audioFile.name : "Click to choose an audio file"}
                </span>
                <input
                  type="file"
                  accept="audio/*,video/mp4,video/mpeg,video/webm"
                  className="hidden"
                  onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Transcribed with Whisper. mp3, m4a, wav, webm, ogg, flac, mp4. Max 25MB.
              </p>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground/90">
                <strong className="block mb-1">Recording consent</strong>
                By uploading, you confirm that every attendee in this recording has been
                informed and has consented to being recorded, transcribed, and summarised.
                South African law (POPIA / RICA) requires consent from all parties.
              </div>
              <label className="flex items-start gap-2 text-sm text-foreground/90">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={keepRecording}
                  onChange={(e) => setKeepRecording(e.target.checked)}
                />
                <span>
                  <span className="block">Keep the audio recording for this meeting</span>
                  <span className="block text-xs text-muted-foreground">
                    Off by default, only the transcript and summary are stored.
                  </span>
                </span>
              </label>
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
