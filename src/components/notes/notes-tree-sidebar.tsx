import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
  Pin,
  Clock,
  FolderIcon,
  Plus,
  MoreHorizontal,
  Pencil,
  Palette,
  Trash2,
  FolderPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Business } from "@/lib/businesses";
import { createFolder, deleteFolder, updateFolder, type Folder } from "@/lib/tasks";
import type { Note } from "@/lib/notes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ALL } from "@/hooks/use-active-business";
import { cn } from "@/lib/utils";

export type SmartView = "all" | "pinned" | "recent" | "unfiled" | "shared";
export type Scope =
  | { kind: "smart"; view: SmartView; businessId: string | null }
  | { kind: "folder"; folderId: string; businessId: string };

const PALETTE = [
  "#7A8471", "#dc2626", "#ea580c", "#ca8a04",
  "#16a34a", "#2563eb", "#7c3aed", "#db2777",
];

const EXPAND_KEY = "heartbeat.notes_expanded_v1";

type ExpandState = {
  accounts: Record<string, boolean>;
  folders: Record<string, boolean>;
};

function loadExpand(): ExpandState {
  if (typeof window === "undefined") return { accounts: {}, folders: {} };
  try {
    const raw = localStorage.getItem(EXPAND_KEY);
    if (!raw) return { accounts: {}, folders: {} };
    return JSON.parse(raw);
  } catch {
    return { accounts: {}, folders: {} };
  }
}

function saveExpand(s: ExpandState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(EXPAND_KEY, JSON.stringify(s));
}

export function NotesTreeSidebar({
  activeBusinessId,
  scope,
  onScopeChange,
  search,
  onSearchChange,
  notes,
  folders,
  businesses,
}: {
  activeBusinessId: string;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  search: string;
  onSearchChange: (s: string) => void;
  notes: Note[];
  folders: Folder[];
  businesses: Business[];
}) {
  const qc = useQueryClient();
  const [expand, setExpand] = useState<ExpandState>(() => loadExpand());

  useEffect(() => saveExpand(expand), [expand]);

  const memberBizIds = useMemo(() => new Set(businesses.map((b) => b.id)), [businesses]);

  // Notes within current account scope (for overview counts)
  const scopedNotes = useMemo(() => {
    if (activeBusinessId === ALL) return notes;
    return notes.filter((n) => n.business_id === activeBusinessId);
  }, [notes, activeBusinessId]);

  const counts = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    return {
      all: scopedNotes.length,
      pinned: scopedNotes.filter((n) => n.pinned).length,
      recent: scopedNotes.filter((n) => new Date(n.updated_at).getTime() >= weekAgo).length,
      unfiled: scopedNotes.filter((n) => !n.folder_id).length,
      shared: scopedNotes.filter((n) => n.business_id && !memberBizIds.has(n.business_id)).length,
    };
  }, [scopedNotes, memberBizIds]);

  const visibleBusinesses = useMemo(() => {
    if (activeBusinessId === ALL) return businesses;
    return businesses.filter((b) => b.id === activeBusinessId);
  }, [businesses, activeBusinessId]);

  const folderCountByBusiness = (bizId: string) =>
    notes.filter((n) => n.business_id === bizId && n.folder_id).length;

  const toggleAccount = (id: string) =>
    setExpand((s) => ({ ...s, accounts: { ...s.accounts, [id]: !(s.accounts[id] ?? true) } }));

  const toggleFolder = (id: string) =>
    setExpand((s) => ({ ...s, folders: { ...s.folders, [id]: !s.folders[id] } }));

  const isSmart = (v: SmartView) =>
    scope.kind === "smart" &&
    scope.view === v &&
    (scope.businessId ?? null) === (activeBusinessId === ALL ? null : activeBusinessId);

  const setSmart = (v: SmartView) =>
    onScopeChange({
      kind: "smart",
      view: v,
      businessId: activeBusinessId === ALL ? null : activeBusinessId,
    });

  const handleAddFolder = async (bizId: string, parentId: string | null) => {
    const name = window.prompt(parentId ? "Sub-folder name" : "Folder name", "");
    if (!name?.trim()) return;
    try {
      await createFolder({
        business_id: bizId,
        name: name.trim(),
        parent_folder_id: parentId,
      });
      qc.invalidateQueries({ queryKey: ["folders"] });
      if (parentId) setExpand((s) => ({ ...s, folders: { ...s.folders, [parentId]: true } }));
      else setExpand((s) => ({ ...s, accounts: { ...s.accounts, [bizId]: true } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create folder");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search notes"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* OVERVIEW */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 mb-1">
            Overview
          </div>
          <div className="space-y-0.5">
            <SmartRow
              icon={FileText}
              label="All notes"
              count={counts.all}
              active={isSmart("all")}
              onClick={() => setSmart("all")}
            />
            <SmartRow
              icon={Clock}
              label="Recent"
              count={counts.recent}
              active={isSmart("recent")}
              onClick={() => setSmart("recent")}
            />
            <SmartRow
              icon={Pin}
              label="Pinned"
              count={counts.pinned}
              active={isSmart("pinned")}
              onClick={() => setSmart("pinned")}
            />
            <SmartRow
              icon={FolderIcon}
              label="Unfiled"
              count={counts.unfiled}
              active={isSmart("unfiled")}
              onClick={() => setSmart("unfiled")}
            />
            {counts.shared > 0 && (
              <SmartRow
                icon={Users}
                label="Shared with me"
                count={counts.shared}
                active={isSmart("shared")}
                onClick={() => setSmart("shared")}
              />
            )}
          </div>
        </div>

        {/* PER-ACCOUNT SECTIONS */}
        <div className="space-y-2">
          {visibleBusinesses.map((biz) => {
            const open = expand.accounts[biz.id] ?? true;
            const roots = folders.filter(
              (f) => f.business_id === biz.id && !f.parent_folder_id,
            );
            return (
              <div
                key={biz.id}
                className="rounded-lg border border-border/60 bg-card/30 overflow-hidden"
              >
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    onClick={() => toggleAccount(biz.id)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: biz.color }}
                    />
                    <span className="text-sm font-medium truncate">{biz.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto pl-1">
                      {folderCountByBusiness(biz.id)}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="New folder"
                    onClick={() => handleAddFolder(biz.id, null)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {open && (
                  <div className="pb-1">
                    {roots.length === 0 && (
                      <p className="px-3 pb-2 text-[11px] text-muted-foreground italic">
                        No folders yet.
                      </p>
                    )}
                    {roots.map((f) => (
                      <FolderNode
                        key={f.id}
                        folder={f}
                        allFolders={folders}
                        notes={notes}
                        depth={1}
                        expand={expand}
                        toggleFolder={toggleFolder}
                        scope={scope}
                        onSelect={(fid) =>
                          onScopeChange({
                            kind: "folder",
                            folderId: fid,
                            businessId: biz.id,
                          })
                        }
                        onAddSub={(pid) => handleAddFolder(biz.id, pid)}
                        onChanged={() => qc.invalidateQueries({ queryKey: ["folders"] })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {visibleBusinesses.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">No accounts yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SmartRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  count: number;
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
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

function FolderNode({
  folder,
  allFolders,
  notes,
  depth,
  expand,
  toggleFolder,
  scope,
  onSelect,
  onAddSub,
  onChanged,
}: {
  folder: Folder;
  allFolders: Folder[];
  notes: Note[];
  depth: number;
  expand: ExpandState;
  toggleFolder: (id: string) => void;
  scope: Scope;
  onSelect: (folderId: string) => void;
  onAddSub: (parentId: string) => void;
  onChanged: () => void;
}) {
  const children = allFolders.filter((f) => f.parent_folder_id === folder.id);
  const hasChildren = children.length > 0;
  const open = expand.folders[folder.id] ?? false;
  const active = scope.kind === "folder" && scope.folderId === folder.id;
  const count = notes.filter((n) => n.folder_id === folder.id).length;
  const canAddSub = depth < 3;

  const rename = async () => {
    const v = window.prompt("Folder name", folder.name);
    if (!v?.trim() || v.trim() === folder.name) return;
    try {
      await updateFolder(folder.id, { name: v.trim() });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const setColor = async (color: string) => {
    try {
      await updateFolder(folder.id, { color });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${folder.name}"? Notes inside will move to Unfiled. Sub-folders will be removed.`,
      )
    )
      return;
    try {
      await deleteFolder(folder.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 pr-1 rounded-md text-sm transition-colors",
          active ? "bg-muted" : "hover:bg-muted/60",
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          onClick={() => (hasChildren ? toggleFolder(folder.id) : onSelect(folder.id))}
          className="p-1"
          aria-label={hasChildren ? "Toggle" : "Open"}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : (
            <span className="inline-block w-3" />
          )}
        </button>
        <button
          onClick={() => onSelect(folder.id)}
          className="flex items-center gap-2 flex-1 py-1 min-w-0 text-left"
        >
          <FolderIcon className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color }} />
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-[10px] text-muted-foreground">{count}</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canAddSub && (
              <DropdownMenuItem onClick={() => onAddSub(folder.id)}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> New sub-folder
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={rename}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
            </DropdownMenuItem>
            <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
              <Palette className="h-3.5 w-3.5" /> Colour
            </div>
            <div className="px-2 pb-2 grid grid-cols-4 gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={(e) => {
                    e.stopPropagation();
                    setColor(c);
                  }}
                  className={cn(
                    "h-5 w-5 rounded-full border border-border",
                    folder.color === c && "ring-2 ring-ring",
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={remove} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasChildren && open && (
        <div>
          {children.map((c) => (
            <FolderNode
              key={c.id}
              folder={c}
              allFolders={allFolders}
              notes={notes}
              depth={depth + 1}
              expand={expand}
              toggleFolder={toggleFolder}
              scope={scope}
              onSelect={onSelect}
              onAddSub={onAddSub}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function folderPath(folderId: string | null, folders: Folder[]): Folder[] {
  if (!folderId) return [];
  const map = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let cur = map.get(folderId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_folder_id ? map.get(cur.parent_folder_id) : undefined;
  }
  return out;
}
