import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  FolderIcon,
  FileText,
  Pin,
  PinOff,
  Search,
  Clock,
  StickyNote,
  CalendarDays,
  Users,
  GitBranch,
  BookOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { listBusinesses } from "@/lib/businesses";
import { listFolders } from "@/lib/tasks";
import {
  listNotes,
  updateNote,
  deleteNote,
  pinNote,
  type Note,
} from "@/lib/notes";
import { NOTE_TYPES, type NoteType } from "@/lib/note-templates";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TagPeople } from "@/components/tag-people";
import { MarkdownEditor, useAutosave } from "@/components/notes/markdown-editor";
import { NewNoteDialog } from "@/components/notes/new-note-dialog";
import { AttachmentsPanel } from "@/components/notes/attachments-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/notes")({
  component: NotesPage,
});

type SidebarView =
  | { kind: "all" }
  | { kind: "pinned" }
  | { kind: "recent" }
  | { kind: "unfiled" }
  | { kind: "folder"; id: string };

const TYPE_ICONS: Record<NoteType, typeof FileText> = {
  note: StickyNote,
  journal: BookOpen,
  meeting: Users,
  project: GitBranch,
  decision: CalendarDays,
};

function NotesPage() {
  const { activeId } = useActiveBusiness();
  const qc = useQueryClient();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: listNotes });

  const [view, setView] = useState<SidebarView>({ kind: "all" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const scopedFolders = useMemo(() => {
    if (activeId === ALL) return folders;
    return folders.filter((f) => f.business_id === activeId);
  }, [folders, activeId]);

  const scopedNotes = useMemo(() => {
    let out = notes;
    if (activeId !== ALL) out = out.filter((n) => n.business_id === activeId);
    switch (view.kind) {
      case "pinned": out = out.filter((n) => n.pinned); break;
      case "recent": {
        const week = Date.now() - 7 * 24 * 3600 * 1000;
        out = out.filter((n) => new Date(n.updated_at).getTime() >= week);
        break;
      }
      case "unfiled": out = out.filter((n) => !n.folder_id); break;
      case "folder": out = out.filter((n) => n.folder_id === view.id); break;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((n) =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      );
    }
    return out;
  }, [notes, activeId, view, search]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left rail */}
      <aside className="w-60 shrink-0 border-r border-border p-3 overflow-y-auto space-y-4">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <div className="space-y-0.5">
          <RailRow
            icon={FileText}
            label="All notes"
            active={view.kind === "all"}
            onClick={() => setView({ kind: "all" })}
          />
          <RailRow
            icon={Pin}
            label="Pinned"
            active={view.kind === "pinned"}
            onClick={() => setView({ kind: "pinned" })}
          />
          <RailRow
            icon={Clock}
            label="Recent"
            active={view.kind === "recent"}
            onClick={() => setView({ kind: "recent" })}
          />
          <RailRow
            icon={FolderIcon}
            label="Unfiled"
            active={view.kind === "unfiled"}
            onClick={() => setView({ kind: "unfiled" })}
          />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 mb-1">Folders</div>
          <div className="space-y-0.5">
            {scopedFolders.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground">No folders yet.</p>
            )}
            {scopedFolders.map((f) => {
              const biz = businesses.find((b) => b.id === f.business_id);
              return (
                <RailRow
                  key={f.id}
                  icon={FolderIcon}
                  label={f.name}
                  sublabel={activeId === ALL ? biz?.name : undefined}
                  color={f.color}
                  active={view.kind === "folder" && view.id === f.id}
                  onClick={() => setView({ kind: "folder", id: f.id })}
                />
              );
            })}
          </div>
        </div>
      </aside>

      {/* Notes list */}
      <div className="w-80 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-3 flex items-center justify-between sticky top-0 bg-background z-10 border-b border-border">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Notes</h2>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
        </div>
        <div className="p-2 space-y-1">
          {scopedNotes.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground text-center">
              No notes here yet.
            </p>
          )}
          {scopedNotes.map((n) => {
            const Icon = TYPE_ICONS[n.note_type] ?? FileText;
            return (
              <button
                key={n.id}
                onClick={() => setSelectedNoteId(n.id)}
                className={cn(
                  "w-full text-left p-2.5 rounded-lg transition-colors",
                  selectedNoteId === n.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium truncate">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{n.title || "Untitled"}</span>
                  {n.pinned && <Pin className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-1">
                  {stripMd(n.body).slice(0, 80) || "—"}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(n.updated_at), { addSuffix: true })} · {n.note_type}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            folders={folders}
            onChanged={() => qc.invalidateQueries({ queryKey: ["notes"] })}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ["notes"] });
              setSelectedNoteId(null);
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <StickyNote className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Pick a note, or create a new one with the guided flow.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New note
            </Button>
          </div>
        )}
      </div>

      <NewNoteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultBusinessId={activeId === ALL ? null : activeId}
        defaultFolderId={view.kind === "folder" ? view.id : null}
        onCreated={(n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          setSelectedNoteId(n.id);
        }}
      />
    </div>
  );
}

function RailRow({
  icon: Icon,
  label,
  sublabel,
  color,
  active,
  onClick,
}: {
  icon: typeof FileText;
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
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={color ? { color } : undefined} />
      <span className="flex-1 truncate">{label}</span>
      {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
    </button>
  );
}

function NoteEditor({
  note,
  folders,
  onChanged,
  onDeleted,
}: {
  note: Note;
  folders: { id: string; name: string; business_id: string }[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [type, setType] = useState<NoteType>(note.note_type);
  const [folderId, setFolderId] = useState<string | null>(note.folder_id);

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setType(note.note_type);
    setFolderId(note.folder_id);
  }, [note.id]);

  const { savedAt, saving } = useAutosave(
    { title, body, type, folderId },
    async (v) => {
      await updateNote(note.id, {
        title: v.title,
        body: v.body,
        note_type: v.type,
        folder_id: v.folderId,
      });
      onChanged();
    },
  );

  const scopedFolders = folders.filter((f) => f.business_id === note.business_id);

  const togglePin = async () => {
    try {
      await pinNote(note.id, !note.pinned);
      onChanged();
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

  const status = saving
    ? "Saving…"
    : savedAt
      ? `Saved · updated ${formatDistanceToNow(savedAt, { addSuffix: true })}`
      : `Updated ${formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}`;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-10 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">{status}</div>
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as NoteType)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NOTE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={folderId ?? "__none"}
            onValueChange={(v) => setFolderId(v === "__none" ? null : v)}
          >
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Folder" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Unfiled</SelectItem>
              {scopedFolders.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={togglePin} title={note.pinned ? "Unpin" : "Pin"}>
            {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-2xl font-serif border-none px-0 focus-visible:ring-0 shadow-none h-auto py-1"
        placeholder="Untitled"
      />

      <MarkdownEditor value={body} onChange={setBody} />

      <div className="pt-4 border-t border-border space-y-4">
        <AttachmentsPanel note={note} />
        <TagPeople itemType="note" itemId={note.id} businessId={note.business_id} />
      </div>
    </div>
  );
}

function stripMd(s: string) {
  return s
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
