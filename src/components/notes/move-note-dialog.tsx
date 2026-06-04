import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, FolderIcon } from "lucide-react";
import { toast } from "sonner";
import type { Business } from "@/lib/businesses";
import type { Folder } from "@/lib/tasks";
import { moveNote, type Note } from "@/lib/notes";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MoveNoteDialog({
  open,
  onOpenChange,
  note,
  businesses,
  folders,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  note: Note | null;
  businesses: Business[];
  folders: Folder[];
  onMoved: () => void;
}) {
  const [target, setTarget] = useState<{ businessId: string; folderId: string | null } | null>(
    null,
  );
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rootsByBiz = useMemo(() => {
    const m = new Map<string, Folder[]>();
    for (const b of businesses) m.set(b.id, []);
    for (const f of folders) {
      if (!f.parent_folder_id && m.has(f.business_id)) m.get(f.business_id)!.push(f);
    }
    return m;
  }, [folders, businesses]);

  if (!note) return null;

  const requestMove = () => {
    if (!target) return;
    if (target.businessId !== note.business_id && note.business_id) {
      setConfirm(true);
      return;
    }
    doMove();
  };

  const doMove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await moveNote(note.id, { business_id: target.businessId, folder_id: target.folderId });
      toast.success("Note moved");
      onMoved();
      onOpenChange(false);
      setTarget(null);
      setConfirm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move note</DialogTitle>
          <DialogDescription>Pick an account and folder for this note.</DialogDescription>
        </DialogHeader>

        {confirm ? (
          <div className="space-y-3 text-sm">
            <p className="text-foreground">
              Moving to a different account changes who can see this note. Sharing in the
              destination account will determine access.
            </p>
            <p className="text-muted-foreground">Continue?</p>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto border border-border rounded-md p-1">
            {businesses.map((b) => {
              const open = expanded[b.id] ?? true;
              const roots = rootsByBiz.get(b.id) ?? [];
              return (
                <div key={b.id}>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1"
                      onClick={() => setExpanded((s) => ({ ...s, [b.id]: !open }))}
                    >
                      {open ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      onClick={() => setTarget({ businessId: b.id, folderId: null })}
                      className={cn(
                        "flex items-center gap-2 flex-1 text-left text-sm px-2 py-1 rounded-md",
                        target?.businessId === b.id && target?.folderId === null
                          ? "bg-muted"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: b.color }}
                      />
                      <span className="font-medium">{b.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">Unfiled</span>
                    </button>
                  </div>
                  {open &&
                    roots.map((f) => (
                      <FolderPick
                        key={f.id}
                        folder={f}
                        folders={folders}
                        depth={1}
                        target={target}
                        setTarget={(t) => setTarget(t)}
                        businessId={b.id}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {confirm ? (
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
                Back
              </Button>
              <Button onClick={doMove} disabled={busy}>
                Move anyway
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={requestMove} disabled={!target}>
                Move
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderPick({
  folder,
  folders,
  depth,
  target,
  setTarget,
  businessId,
}: {
  folder: Folder;
  folders: Folder[];
  depth: number;
  target: { businessId: string; folderId: string | null } | null;
  setTarget: (t: { businessId: string; folderId: string | null }) => void;
  businessId: string;
}) {
  const children = folders.filter((f) => f.parent_folder_id === folder.id);
  const active = target?.folderId === folder.id;
  return (
    <div>
      <button
        onClick={() => setTarget({ businessId, folderId: folder.id })}
        className={cn(
          "w-full flex items-center gap-2 text-sm px-2 py-1 rounded-md text-left",
          active ? "bg-muted" : "hover:bg-muted/60",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FolderIcon className="h-3.5 w-3.5" style={{ color: folder.color }} />
        <span className="truncate">{folder.name}</span>
      </button>
      {children.map((c) => (
        <FolderPick
          key={c.id}
          folder={c}
          folders={folders}
          depth={depth + 1}
          target={target}
          setTarget={setTarget}
          businessId={businessId}
        />
      ))}
    </div>
  );
}
