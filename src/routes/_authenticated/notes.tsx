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
  ChevronDown,
  ChevronLeft,
  PanelLeftOpen,
  Sparkles,
  Share2,
} from "lucide-react";
import { useUiPref } from "@/lib/ui-prefs";
import { ShareDialog } from "@/components/share-dialog";
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
  createNote,
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
import { CreateTaskFromNoteDialog } from "@/components/notes/create-task-from-note-dialog";
import { ConnectionsPanel } from "@/components/notes/connections-panel";
import { NoteContextLinks } from "@/components/notes/note-context-links";
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
  // No SSR loader: listNotes uses the browser Supabase client which has no
  // session during worker SSR / static prerender. Prefetching there primed
  // the cache with an empty/error result and broke the published page.
  // The component's useQuery({ enabled: ready }) fetches once auth restores.
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
  const [creatingInstant, setCreatingInstant] = useState(false);
  const [listCollapsed, setListCollapsed] = useUiPref<boolean>("notes.listCollapsed", false);

  const defaultBusinessId =
    scope.kind === "folder"
      ? scope.businessId
      : scope.businessId ?? (activeId === ALL ? null : activeId);
  const defaultFolderId = scope.kind === "folder" ? scope.folderId : null;

  const handleInstantCreate = async () => {
    if (creatingInstant) return;
    setCreatingInstant(true);
    try {
      // A blank note must always be creatable — no account, no folder, no
      // type chosen. The schema defaults business_id/folder_id to NULL
      // (= Personal / Unfiled) and note_type to 'note', and the RLS insert
      // policy only requires owner_id = auth.uid().
      const n = await createNote({
        business_id: defaultBusinessId,
        folder_id: defaultFolderId,
        title: "",
        body: "",
        note_type: "note",
      });
      await qc.invalidateQueries({ queryKey: ["notes"] });
      setSelectedNoteId(n.id);
    } catch (e) {
      // Surface the real reason — generic "Couldn't create note" hides
      // RLS / privilege errors that we actually need to see.
      console.error("[notes] instant create failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Couldn't create note: ${msg}`);
    } finally {
      setCreatingInstant(false);
    }
  };

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

      {/* Notes list — collapsible on desktop */}
      {listCollapsed ? (
        <div className="hidden md:flex w-10 shrink-0 border-r border-border flex-col items-center py-2 gap-2 bg-background transition-[width] duration-200">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setListCollapsed(false)}
            title="Expand notes list"
            aria-label="Expand notes list"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8"
            onClick={handleInstantCreate}
            disabled={creatingInstant}
            title="New note"
            aria-label="New note"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      <div
        className={cn(
          "w-full md:w-80 shrink-0 border-r border-border overflow-y-auto md:max-w-xs transition-[width] duration-200",
          listCollapsed && "md:hidden",
        )}
      >
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
            <div className="inline-flex rounded-md shadow-sm">
              <Button
                size="sm"
                className="rounded-r-none"
                onClick={handleInstantCreate}
                disabled={creatingInstant}
                title="Start writing immediately"
              >
                <Plus className="h-4 w-4 mr-1" /> New
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                    aria-label="More create options"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={handleInstantCreate}>
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Blank note
                    <span className="ml-auto text-[10px] text-muted-foreground">Default</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                    <Sparkles className="h-3.5 w-3.5 mr-2" />
                    Guided setup…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="hidden md:inline-flex h-8 w-8"
              onClick={() => setListCollapsed(true)}
              title="Collapse notes list"
              aria-label="Collapse notes list"
            >
              <ChevronLeft className="h-4 w-4" />
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
            const crumbs = [biz?.name ?? "Personal", ...path.map((f) => f.name)].filter(Boolean).join(" / ");
            const accentColor = biz?.color ?? "hsl(var(--muted-foreground))";
            return (
              <div
                key={n.id}
                className={cn(
                  "group rounded-lg transition-colors border-l-2",
                  selectedNoteId === n.id ? "bg-muted" : "hover:bg-muted/60",
                )}
                style={{ borderLeftColor: accentColor }}
              >
                <button
                  onClick={() => setSelectedNoteId(n.id)}
                  className="w-full text-left p-2.5"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: accentColor }}
                      title={biz?.name ?? "Personal"}
                    />
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
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={async () => {
                            if (!confirm(`Move "${n.title || "Untitled"}" to Trash?`)) return;
                            try {
                              await deleteNote(n.id);
                              if (selectedNoteId === n.id) setSelectedNoteId(null);
                              qc.invalidateQueries({ queryKey: ["notes"] });
                              showUndoToast(`"${n.title || "Note"}" moved to Trash`, async () => {
                                await restoreNote(n.id);
                                qc.invalidateQueries({ queryKey: ["notes"] });
                              });
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed to delete");
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Move to Trash
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
                    {stripMd(n.body).slice(0, 80) || ","}
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
            onChanged={(patch) => {
              // Patch the cache in place instead of invalidating the whole
              // notes list — invalidation triggered a full GET after every
              // keystroke save and starved the page.
              qc.setQueryData<Note[]>(["notes"], (prev) =>
                (prev ?? []).map((n) =>
                  n.id === selectedNote.id
                    ? { ...n, ...(patch ?? {}), updated_at: new Date().toISOString() }
                    : n,
                ),
              );
            }}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ["notes"] });
              setSelectedNoteId(null);
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <StickyNote className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Pick a note, or start a blank one — write first, organise later.
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={handleInstantCreate} disabled={creatingInstant}>
                <Plus className="h-4 w-4 mr-1" /> New note
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(true)}>
                <Sparkles className="h-4 w-4 mr-1" /> Guided setup
              </Button>
            </div>
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
  onChanged: (patch?: Partial<Note>) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [type, setType] = useState<NoteType>(note.note_type);
  const [folderId, setFolderId] = useState<string | null>(note.folder_id);
  const [businessId, setBusinessId] = useState<string | null>(note.business_id);
  const [createTaskFor, setCreateTaskFor] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setType(note.note_type);
    setFolderId(note.folder_id);
    setBusinessId(note.business_id);
    setCreateTaskFor(null);
  }, [note.id]);

  const { savedAt, saving } = useAutosave(
    { title, body, type, folderId, businessId },
    async (v) => {
      await updateNote(note.id, {
        title: v.title,
        body: v.body,
        note_type: v.type,
        folder_id: v.folderId,
        business_id: v.businessId,
      });
      onChanged({
        title: v.title,
        body: v.body,
        note_type: v.type,
        folder_id: v.folderId,
        business_id: v.businessId,
      });
    },
  );

  const scopedFolders = folders.filter((f) => f.business_id === businessId);
  const biz = businesses.find((b) => b.id === businessId);
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
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={businessId ?? "__none"}
            onValueChange={(v) => {
              const next = v === "__none" ? null : v;
              setBusinessId(next);
              setFolderId(null);
            }}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                  Personal / Uncategorised
                </span>
              </SelectItem>
              {businesses.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                    {b.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {note.note_type !== "journal" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShareOpen(true)}
              title="Share"
            >
              <Share2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={togglePin} title={note.pinned ? "Unpin" : "Pin"}>
            {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" title="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={remove}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        resourceType="note"
        resourceId={note.id}
        resourceName={note.title || "this note"}
      />

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-2xl font-serif border-none px-0 focus-visible:ring-0 shadow-none h-auto py-1"
        placeholder="Untitled"
        autoFocus={!note.title}
      />

      <MarkdownEditor
        value={body}
        onChange={setBody}
        onCreateTask={(hint) => setCreateTaskFor(hint)}
      />

      <CreateTaskFromNoteDialog
        note={note}
        titleHint={createTaskFor ?? ""}
        open={createTaskFor !== null}
        onClose={() => setCreateTaskFor(null)}
      />

      <div className="pt-4 border-t border-border space-y-6">
        <AIPanel note={note} onChanged={onChanged} />
        <LinkedTasksPanel note={note} />
        <NoteContextLinks note={note} onChanged={onChanged} />
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
