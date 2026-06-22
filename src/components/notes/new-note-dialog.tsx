import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listBusinesses, type Business } from "@/lib/businesses";
import { listFolders, createFolder, type Folder } from "@/lib/tasks";
import { listMeetings, type Meeting } from "@/lib/meetings";
import { createNote, type Note } from "@/lib/notes";
import { NOTE_TYPES, templateFor, suggestedTitle, type NoteType } from "@/lib/note-templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBusinessId?: string | null;
  defaultFolderId?: string | null;
  onCreated: (note: Note) => void;
};

type EventRow = { id: string; title: string; start_at: string; business_id: string | null };

export function NewNoteDialog({
  open,
  onOpenChange,
  defaultBusinessId,
  defaultFolderId,
  onCreated,
}: Props) {
  const [step, setStep] = useState(0);
  const [businessId, setBusinessId] = useState<string | null>(defaultBusinessId ?? null);
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null);
  const [type, setType] = useState<NoteType>("note");
  const [title, setTitle] = useState(suggestedTitle("note"));
  const [linkedMeetingId, setLinkedMeetingId] = useState<string | null>(null);
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery<Folder[]>({ queryKey: ["folders"], queryFn: listFolders });
  const { data: meetings = [] } = useQuery<Meeting[]>({
    queryKey: ["meetings", businessId],
    queryFn: () => listMeetings(businessId),
    enabled: !!businessId,
  });
  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["events-link", businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, start_at, business_id")
        .is("deleted_at", null)
        .eq("business_id", businessId!)
        .order("start_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const scopedFolders = useMemo(
    () => folders.filter((f) => f.business_id === businessId),
    [folders, businessId],
  );

  useEffect(() => {
    if (open) {
      setStep(0);
      setBusinessId(defaultBusinessId ?? null);
      setFolderId(defaultFolderId ?? null);
      setType("note");
      setTitle(suggestedTitle("note"));
      setLinkedMeetingId(null);
      setLinkedEventId(null);
      setNewFolderName("");
    }
  }, [open, defaultBusinessId, defaultFolderId]);

  useEffect(() => {
    setTitle(suggestedTitle(type));
  }, [type]);

  const canNext =
    step === 0 ||
    (step === 1 && (folderId !== null || newFolderName.trim() === "")) ||
    step === 2 ||
    step === 3;

  const handleCreateFolder = async () => {
    if (!businessId || !newFolderName.trim()) return;
    try {
      await createFolder({ business_id: businessId, name: newFolderName.trim() });
      const { data } = await supabase
        .from("folders")
        .select("id")
        .is("deleted_at", null)
        .eq("business_id", businessId)
        .eq("name", newFolderName.trim())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) setFolderId(data.id);
      setNewFolderName("");
      toast.success("Folder created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const note = await createNote({
        business_id: businessId,
        folder_id: folderId,
        title: title.trim() || suggestedTitle(type),
        body: templateFor(type),
        note_type: type,
        linked_meeting_id: linkedMeetingId,
        linked_event_id: linkedEventId,
      });
      onCreated(note);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
        </DialogHeader>

        <Stepper step={step} />

        {step === 0 && (
          <div className="space-y-3">
            <Label>Account</Label>
            <Select
              value={businessId ?? "__none"}
              onValueChange={(v) => setBusinessId(v === "__none" ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                    Personal / Uncategorised (no account)
                  </span>
                </SelectItem>
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: b.color }}
                      />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose which account this note belongs to. It stays private to you unless you share it.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <Label>Folder</Label>
            <Select value={folderId ?? "__none"} onValueChange={(v) => setFolderId(v === "__none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Pick a folder" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unfiled</SelectItem>
                {scopedFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                placeholder="Create new folder…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              />
              <Button type="button" variant="outline" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick a home so nothing gets lost.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-1 gap-2">
              {NOTE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors",
                    type === t.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{t.label}</div>
                    {type === t.value && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />

            {meetings.length > 0 && (
              <>
                <Label>Link to meeting (optional)</Label>
                <Select value={linkedMeetingId ?? "__none"} onValueChange={(v) => setLinkedMeetingId(v === "__none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {meetings.slice(0, 50).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {events.length > 0 && (
              <>
                <Label>Link to event (optional)</Label>
                <Select value={linkedEventId ?? "__none"} onValueChange={(v) => setLinkedEventId(v === "__none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title} · {new Date(e.start_at).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create note"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function Stepper({ step }: { step: number }) {
  const labels = ["Account", "Folder", "Type", "Title & links"];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <div
            className={cn(
              "h-5 w-5 rounded-full flex items-center justify-center text-[10px]",
              i <= step ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {i + 1}
          </div>
          <span className={i === step ? "text-foreground font-medium" : ""}>{l}</span>
          {i < labels.length - 1 && <ChevronRight className="h-3 w-3" />}
        </div>
      ))}
    </div>
  );
}
