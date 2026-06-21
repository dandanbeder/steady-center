import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createStage,
  deleteStage,
  fetchStages,
  reorderStages,
  updateStage,
  type TaskStage,
} from "@/lib/task-stages";

const PALETTE = [
  "#7A8471", "#9BA888", "#A8B5A0", "#6B8E7F",
  "#C2A878", "#D4A574", "#B5896F", "#A88B6B",
  "#8B9BB4", "#7A8FA8", "#9BB0C8", "#A3B5CC",
  "#B89BC9", "#A88BB5", "#C9A3D4", "#D4B5C5",
];

export function StageManagerDialog({
  listId,
  open,
  onOpenChange,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: stages = [] } = useQuery({
    queryKey: ["task_stages", listId],
    queryFn: () => fetchStages(listId),
    enabled: open,
  });

  const [newName, setNewName] = useState("");
  const [reassignFor, setReassignFor] = useState<TaskStage | null>(null);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["task_stages", listId] }),
      qc.invalidateQueries({ queryKey: ["tasks", listId] }),
    ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const reorder = useMutation({
    mutationFn: reorderStages,
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const add = useMutation({
    mutationFn: () =>
      createStage({
        list_id: listId,
        name: newName.trim(),
        color: PALETTE[stages.length % PALETTE.length],
        position: stages.length,
      }),
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  function onDragEnd(e: DragEndEvent) {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    const oldIdx = stages.findIndex((s) => s.id === a);
    const newIdx = stages.findIndex((s) => s.id === o);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(stages, oldIdx, newIdx);
    qc.setQueryData<TaskStage[]>(
      ["task_stages", listId],
      next.map((s, i) => ({ ...s, position: i })),
    );
    reorder.mutate(next.map((s) => s.id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workflow stages</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Drag to reorder. Click a colour swatch to recolour. Stages are per list.
        </p>
        <div className="space-y-1.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {stages.map((s) => (
                <StageRow
                  key={s.id}
                  stage={s}
                  canDelete={stages.length > 1}
                  onDelete={() => setReassignFor(s)}
                  onChange={invalidate}
                />
              ))}
            </SortableContext>
          </DndContext>
          {stages.length === 0 && (
            <p className="text-sm text-muted-foreground italic px-1">No stages yet.</p>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) add.mutate();
          }}
          className="flex gap-2 pt-2 border-t border-border"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New stage name"
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!newName.trim() || add.isPending}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>

        {reassignFor && (
          <ReassignDialog
            stage={reassignFor}
            options={stages.filter((s) => s.id !== reassignFor.id)}
            onClose={() => setReassignFor(null)}
            onDone={() => {
              setReassignFor(null);
              invalidate();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StageRow({
  stage,
  canDelete,
  onDelete,
  onChange,
}: {
  stage: TaskStage;
  canDelete: boolean;
  onDelete: () => void;
  onChange: () => void | Promise<unknown>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [showPalette, setShowPalette] = useState(false);

  const save = useMutation({
    mutationFn: (patch: Partial<TaskStage>) => updateStage(stage.id, patch),
    onSuccess: () => onChange(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        aria-label="Reorder stage"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="relative">
        <button
          className="h-4 w-4 rounded-full border border-border"
          style={{ backgroundColor: color }}
          onClick={() => setShowPalette((v) => !v)}
          aria-label="Change colour"
        />
        {showPalette && (
          <div className="absolute z-50 top-6 left-0 grid grid-cols-8 gap-1 rounded-md border border-border bg-popover p-1.5 shadow-md">
            {PALETTE.map((c) => (
              <button
                key={c}
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: c }}
                onClick={() => {
                  setColor(c);
                  setShowPalette(false);
                  save.mutate({ color: c });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== stage.name && save.mutate({ name: name.trim() })}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 text-sm flex-1"
      />
      {canDelete && (
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete} title="Delete stage">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

function ReassignDialog({
  stage,
  options,
  onClose,
  onDone,
}: {
  stage: TaskStage;
  options: TaskStage[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string>(options[0]?.id ?? "");
  const del = useMutation({
    mutationFn: () => deleteStage(stage.id, target),
    onSuccess: () => {
      toast.success(`Deleted "${stage.name}"`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete "{stage.name}"</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Move any tasks in this stage to:
        </p>
        <div className="space-y-1">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => setTarget(o.id)}
              className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm ${
                target === o.id ? "border-accent bg-accent/5" : "border-border"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.color }} />
              {o.name}
            </button>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button onClick={() => del.mutate()} disabled={!target || del.isPending}>
            {del.isPending ? "Deleting…" : "Delete & move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
