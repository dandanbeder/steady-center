import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FolderIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { listBusinesses } from "@/lib/businesses";
import { listFolders, createFolder } from "@/lib/tasks";
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  type Note,
} from "@/lib/notes";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TagPeople } from "@/components/tag-people";

export const Route = createFileRoute("/_authenticated/notes")({
  component: NotesPage,
});

function NotesPage() {
  const { activeId } = useActiveBusiness();
  const qc = useQueryClient();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: listNotes });

  const [selectedFolderId, setSelectedFolderId] = useState<string | "all" | "unfiled">("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const scopedFolders = useMemo(() => {
    if (activeId === ALL) return folders;
    return folders.filter((f) => f.business_id === activeId);
  }, [folders, activeId]);

  const scopedNotes = useMemo(() => {
    let out = notes;
    if (activeId !== ALL) out = out.filter((n) => n.business_id === activeId);
    if (selectedFolderId === "unfiled") out = out.filter((n) => !n.folder_id);
    else if (selectedFolderId !== "all")
      out = out.filter((n) => n.folder_id === selectedFolderId);
    return out;
  }, [notes, activeId, selectedFolderId]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  const onNewNote = async () => {
    const biz = activeId === ALL ? null : activeId;
    const folderId =
      selectedFolderId !== "all" && selectedFolderId !== "unfiled" ? selectedFolderId : null;
    try {
      const note = await createNote({
        business_id: biz,
        folder_id: folderId,
        title: "Untitled note",
        body: "",
      });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setSelectedNoteId(note.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onAddFolder = async () => {
    if (activeId === ALL) {
      toast.error("Pick a business to add a folder.");
      return;
    }
    if (!newFolderName.trim()) return;
    try {
      await createFolder({ business_id: activeId, name: newFolderName.trim() });
      setNewFolderName("");
      qc.invalidateQueries({ queryKey: ["folders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Folder sidebar */}
      <aside className="w-64 shrink-0 border-r border-border p-4 overflow-y-auto">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Folders</h2>
        <div className="space-y-1">
          <FolderRow
            label="All notes"
            active={selectedFolderId === "all"}
            onClick={() => setSelectedFolderId("all")}
          />
          <FolderRow
            label="Unfiled"
            active={selectedFolderId === "unfiled"}
            onClick={() => setSelectedFolderId("unfiled")}
          />
          {scopedFolders.map((f) => {
            const biz = businesses.find((b) => b.id === f.business_id);
            return (
              <FolderRow
                key={f.id}
                label={f.name}
                sublabel={activeId === ALL ? biz?.name : undefined}
                color={f.color}
                active={selectedFolderId === f.id}
                onClick={() => setSelectedFolderId(f.id)}
              />
            );
          })}
        </div>
        {activeId !== ALL && (
          <div className="mt-4 flex gap-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder"
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && onAddFolder()}
            />
            <Button size="sm" variant="outline" onClick={onAddFolder}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </aside>

      {/* Notes list */}
      <div className="w-80 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Notes</h2>
          <Button size="sm" variant="ghost" onClick={onNewNote}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-2 pb-4 space-y-1">
          {scopedNotes.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">No notes yet.</p>
          )}
          {scopedNotes.map((n) => (
            <button
              key={n.id}
              onClick={() => setSelectedNoteId(n.id)}
              className={cn(
                "w-full text-left p-3 rounded-lg transition-colors",
                selectedNoteId === n.id
                  ? "bg-muted"
                  : "hover:bg-muted/60",
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium truncate">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {n.title || "Untitled"}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1">
                {n.body.slice(0, 80) || "—"}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                {new Date(n.created_at).toLocaleDateString()}
                {n.source === "voice" && " · voice"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onSaved={() => qc.invalidateQueries({ queryKey: ["notes"] })}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ["notes"] });
              setSelectedNoteId(null);
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Pick a note or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function FolderRow({
  label,
  sublabel,
  color,
  active,
  onClick,
}: {
  label: string;
  sublabel?: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <FolderIcon
        className="h-4 w-4 shrink-0"
        style={color ? { color } : undefined}
      />
      <span className="flex-1 truncate">{label}</span>
      {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
    </button>
  );
}

function NoteEditor({
  note,
  onSaved,
  onDeleted,
}: {
  note: Note;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [dirty, setDirty] = useState(false);

  const save = async () => {
    try {
      await updateNote(note.id, { title, body });
      setDirty(false);
      onSaved();
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async () => {
    if (!confirm("Delete this note?")) return;
    try {
      await deleteNote(note.id);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {new Date(note.created_at).toLocaleString()} · {note.source}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={!dirty}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setDirty(true);
        }}
        className="text-2xl font-serif border-none px-0 focus-visible:ring-0 shadow-none"
        placeholder="Untitled"
      />
      <Textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDirty(true);
        }}
        rows={20}
        className="border-none px-0 focus-visible:ring-0 resize-none shadow-none text-base leading-relaxed"
        placeholder="Start writing…"
      />
      <div className="pt-4 border-t border-border">
        <TagPeople itemType="note" itemId={note.id} businessId={note.business_id} />
      </div>
    </div>
  );
}
