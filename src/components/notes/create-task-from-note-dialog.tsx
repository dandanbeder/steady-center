import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flag, ListTodo } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  listFolders,
  listLists,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  type TaskPriority,
} from "@/lib/tasks";
import type { Note } from "@/lib/notes";

type Props = {
  note: Note;
  titleHint: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export function CreateTaskFromNoteDialog({
  note,
  titleHint,
  open,
  onClose,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const { data: folders = [] } = useQuery({
    queryKey: ["folders"],
    queryFn: listFolders,
  });
  const { data: lists = [] } = useQuery({
    queryKey: ["lists"],
    queryFn: listLists,
  });

  // Lists scoped to the note's account (or personal: any list whose folder has no business)
  const scopedLists = useMemo(
    () =>
      lists.filter((l) => {
        const f = folders.find((x) => x.id === l.folder_id);
        if (!f) return false;
        return note.business_id ? f.business_id === note.business_id : true;
      }),
    [lists, folders, note.business_id],
  );

  const [title, setTitle] = useState(titleHint);
  const [listId, setListId] = useState<string>("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState("");

  // Hydrate defaults whenever a new titleHint comes in or lists arrive
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== `${note.id}|${titleHint}`) {
    setTitle(titleHint);
    setPriority("normal");
    setDueAt("");
    if (scopedLists[0]) setListId(scopedLists[0].id);
    setSeededFor(`${note.id}|${titleHint}`);
  }

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      if (!title.trim()) throw new Error("Title is required");
      if (!listId) throw new Error("Pick a list");
      const dueIso = dueAt ? `${dueAt}T12:00:00.000Z` : null;
      const { error } = await supabase.from("tasks").insert({
        list_id: listId,
        business_id: note.business_id,
        title: title.trim(),
        status: "todo",
        priority,
        due_at: dueIso,
        position: 0,
        owner_id: u.user.id,
        source_note_id: note.id,
        source_type: "note",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task created");
      qc.invalidateQueries({ queryKey: ["note-linked-tasks", note.id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setSeededFor(null);
      onCreated?.();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSeededFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" /> Create task from note
          </DialogTitle>
          <DialogDescription>
            Linked to "{note.title || "Untitled"}".
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </div>
          <div>
            <Label>List</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger>
                <SelectValue placeholder={scopedLists.length ? "Pick a list" : "No lists yet"} />
              </SelectTrigger>
              <SelectContent>
                {scopedLists.map((l) => {
                  const f = folders.find((x) => x.id === l.folder_id);
                  return (
                    <SelectItem key={l.id} value={l.id}>
                      {f?.name ? `${f.name} / ` : ""}
                      {l.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {scopedLists.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Create a list in Tasks first, then come back.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["urgent", "high", "normal", "low"] as TaskPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="inline-flex items-center gap-2">
                        <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[p] }} />
                        {PRIORITY_LABEL[p]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !title.trim() || !listId}
          >
            {create.isPending ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
