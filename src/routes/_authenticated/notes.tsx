import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/use-auth-ready";
import {
  Plus,
  Trash2,
  FileText,
  Pin,
  PinOff,
  StickyNote,
  CalendarDays,
  Users,
  GitBranch,
  BookOpen,
  MoreHorizontal,
  ArrowRightLeft,
  Menu,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { listBusinesses, type Business } from "@/lib/businesses";
import { listFolders, type Folder } from "@/lib/tasks";
import {
  listNotes,
  updateNote,
  deleteNote,
  restoreNote,
  pinNote,
  type Note,
} from "@/lib/notes";
import { showUndoToast } from "@/lib/undo-toast";
import { NOTE_TYPES, type NoteType } from "@/lib/note-templates";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TagPeople } from "@/components/tag-people";
import { ActivityAndComments } from "@/components/comments/activity-and-comments";

import { MarkdownEditor, useAutosave } from "@/components/notes/markdown-editor";
import { NewNoteDialog } from "@/components/notes/new-note-dialog";
import { AttachmentsPanel } from "@/components/notes/attachments-panel";
import { AIPanel } from "@/components/notes/ai-panel";
import { LinkedTasksPanel } from "@/components/notes/linked-tasks-panel";
import { ConnectionsPanel } from "@/components/notes/connections-panel";
import {
  NotesTreeSidebar,
  folderPath,
  type Scope,
} from "@/components/notes/notes-tree-sidebar";
import { MoveNoteDialog } from "@/components/notes/move-note-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/notes")({
  head: () => ({ meta: [{ title: "Notes · Heartbeat" }] }),
  component: NotesPage,
});

const TYPE_ICONS: Record<NoteType, typeof FileText> = {
  note: StickyNote,
  journal: BookOpen,
  meeting: Users,
  project: GitBranch,
  decision: CalendarDays,
};

function NotesPage() {
  const { activeId } = useActiveBusiness();
  const { ready } = useAuthReady();
  const qc = useQueryClient();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses, enabled: ready });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders, enabled: ready });
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: listNotes, enabled: ready });

  const [scope, setScope] = useState<Scope>({ kind: "smart", view: "all", businessId: null });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [moveNote, setMoveNote] = useState<Note | null>(null);

  // When active account changes, retarget smart scope
  useEffect(() => {
    setScope((s) =>
      s.kind === "smart"
        ? { ...s, businessId: activeId === ALL ? null : activeId }
        : s,
    );
  }, [activeId]);

  const memberBizIds = useMemo(() => new Set(businesses.map((b) => b.id)), [businesses]);

  const scopedNotes = useMemo(() => {
    let out = notes;
    if (scope.kind === "smart") {
      if (scope.businessId) out = out.filter((n) => n.business_id === scope.businessId);
      switch (scope.view) {
        case "pinned":
          out = out.filter((n) => n.pinned);
          break;
        case "recent": {
          const week = Date.now() - 7 * 24 * 3600 * 1000;
          out = out.filter((n) => new Date(n.updated_at).getTime() >= week);
          break;
        }
        case "unfiled":
          out = out.filter((n) => !n.folder_id);
          break;
        case "shared":
          out = out.filter((n) => n.business_id && !memberBizIds.has(n.business_id));
          break;
        case "all":
        default:
          break;
      }
    } else {
      out = out.filter(
        (n) => n.folder_id === scope.folderId && n.business_id === scope.businessId,
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((n) =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      );
    }
    return out;
  }, [notes, scope, search, memberBizIds]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  const scopeLabel = useMemo(() => {
    if (scope.kind === "smart") {
      const biz = scope.businessId ? businesses.find((b) => b.id === scope.businessId) : null;
      const view = SCOPE_VIEW_LABELS[scope.view];
      return biz ? `${biz.name} · ${view}` : view;
    }
    const biz = businesses.find((b) => b.id === scope.businessId);
    const path = folderPath(scope.folderId, folders);
    return [biz?.name, ...path.map((f) => f.name)].filter(Boolean).join(" / ");
  }, [scope, businesses, folders]);

  const sidebar = (
    <NotesTreeSidebar
      activeBusinessId={activeId}
      scope={scope}
      onScopeChange={(s) => {
        setScope(s);
        setMobileNav(false);
      }}
      search={search}
      onSearchChange={setSearch}
      notes={notes}
      folders={folders}
      businesses={businesses}
    />
  );

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <h1 className="sr-only">Notes</h1>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 border-r border-border flex-col">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="p-0 w-80">
          <SheetHeader className="p-3 border-b border-border">
            <SheetTitle>Notes</SheetTitle>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      {/* Notes list */}
      <div className="w-full md:w-80 shrink-0 border-r border-border overflow-y-auto md:max-w-xs">
        <div className="p-3 sticky top-0 bg-background z-10 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden h-8 w-8"
              onClick={() => setMobileNav(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Scope
              </div>
              <div className="text-sm truncate flex items-center gap-1">
                {scopeLabel.split(" / ").map((part, i, arr) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <span className={cn("truncate", i === arr.length - 1 && "font-medium")}>
                      {part}
                    </span>
                    {i < arr.length - 1 && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </span>
                ))}
              </div>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          </div>
        </div>
        <div className="p-2 space-y-1">
          {scopedNotes.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground text-center">
              No notes here yet.
            </p>
          )}
          {scopedNotes.map((n) => {
            const Icon = TYPE_ICONS[n.note_type] ?? FileText;
            const biz = businesses.find((b) => b.id === n.business_id);
            const path = folderPath(n.folder_id, folders);
            const crumbs = [biz?.name, ...path.map((f) => f.name)].filter(Boolean).join(" / ");
            return (
              <div
                key={n.id}
                className={cn(
                  "group rounded-lg transition-colors",
                  selectedNoteId === n.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <button
                  onClick={() => setSelectedNoteId(n.id)}
                  className="w-full text-left p-2.5"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{n.title || "Untitled"}</span>
                    {n.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setMoveNote(n)}>
                          <ArrowRightLeft className="h-3.5 w-3.5 mr-2" /> Move to…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {crumbs && (
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {crumbs}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {stripMd(n.body).slice(0, 80) || "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.updated_at), { addSuffix: true })} ·{" "}
                    {n.note_type}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto hidden md:block">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            folders={folders}
            businesses={businesses}
            onMove={() => setMoveNote(selectedNote)}
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
        defaultBusinessId={
          scope.kind === "folder"
            ? scope.businessId
            : scope.businessId ?? (activeId === ALL ? null : activeId)
        }
        defaultFolderId={scope.kind === "folder" ? scope.folderId : null}
        onCreated={(n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          setSelectedNoteId(n.id);
        }}
      />

      <MoveNoteDialog
        open={!!moveNote}
        onOpenChange={(v) => !v && setMoveNote(null)}
        note={moveNote}
        businesses={businesses}
        folders={folders}
        onMoved={() => qc.invalidateQueries({ queryKey: ["notes"] })}
      />
    </div>
  );
}

const SCOPE_VIEW_LABELS: Record<string, string> = {
  all: "All notes",
  pinned: "Pinned",
  recent: "Recent",
  unfiled: "Unfiled",
  shared: "Shared with me",
};

function NoteEditor({
  note,
  folders,
  businesses,
  onMove,
  onChanged,
  onDeleted,
}: {
  note: Note;
  folders: Folder[];
  businesses: Business[];
  onMove: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [type, setType] = useState<NoteType>(note.note_type);
  const [folderId, setFolderId] = useState<string | null>(note.folder_id);
  const [createTaskFor, setCreateTaskFor] = useState<string | null>(null);

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setType(note.note_type);
    setFolderId(note.folder_id);
    setCreateTaskFor(null);
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
  const biz = businesses.find((b) => b.id === note.business_id);
  const path = folderPath(folderId, folders);

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
      const noteId = note.id;
      const title = note.title || "Note";
      onDeleted();
      showUndoToast(`"${title}" deleted`, async () => {
        await restoreNote(noteId);
        onChanged();
      });
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
        {biz && (
          <>
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: biz.color }}
            />
            <span>{biz.name}</span>
          </>
        )}
        {path.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <span>{f.name}</span>
          </span>
        ))}
        {!biz && <span className="italic">Personal</span>}
      </div>

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
              {scopedFolders.map((f) => {
                const p = folderPath(f.id, folders).map((x) => x.name).join(" / ");
                return (
                  <SelectItem key={f.id} value={f.id}>{p || f.name}</SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={onMove} title="Move to…">
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
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

      <div className="pt-4 border-t border-border space-y-6">
        <AIPanel note={note} onChanged={onChanged} />
        <LinkedTasksPanel noteId={note.id} />
        <ConnectionsPanel noteId={note.id} businessId={note.business_id} />
        <AttachmentsPanel note={note} />
        <TagPeople itemType="note" itemId={note.id} businessId={note.business_id} />
        <ActivityAndComments parentType="note" parentId={note.id} businessId={note.business_id} />

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
