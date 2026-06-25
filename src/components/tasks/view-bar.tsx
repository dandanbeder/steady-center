import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  ChevronDown,
  LayoutList,
  Columns,
  CalendarDays,
  GanttChart,
  MoreHorizontal,
  Pin,
  PinOff,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Users2,
  Target,
  Focus as FocusIcon,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  listTaskViews,
  createTaskView,
  updateTaskView,
  deleteTaskView,
  type TaskView,
  type ViewKind,
} from "@/lib/task-views";
import type {
  GroupByKey,
  ListViewFilters,
  SortKey,
} from "@/lib/user-list-views";
import { describeView, type ViewDraft } from "@/lib/task-views-ai.functions";

export type ActiveViewState = {
  view: ViewKind;
  group_by: GroupByKey;
  filters: ListViewFilters;
  sort: { key: SortKey };
};

export type Preset = {
  id: string;
  label: string;
  icon: typeof FocusIcon;
  state: ActiveViewState;
};

export const VIEW_PRESETS: Preset[] = [
  {
    id: "preset:by-business",
    label: "By Account",
    icon: Building2,
    state: {
      view: "list",
      group_by: "business",
      filters: { priority: "all", status: "all", due: "all", assigned: "all", outcome: "all" },
      sort: { key: "priority" },
    },
  },
  {
    id: "preset:by-outcome",
    label: "By Outcome",
    icon: Target,
    state: {
      view: "list",
      group_by: "outcome",
      filters: { priority: "all", status: "all", due: "all", assigned: "all", outcome: "all" },
      sort: { key: "priority" },
    },
  },
  {
    id: "preset:this-week",
    label: "This Week",
    icon: FocusIcon,
    state: {
      view: "board",
      group_by: "stage",
      filters: { priority: "all", status: "all", due: "week", assigned: "all", outcome: "all" },
      sort: { key: "due" },
    },
  },
];

const VIEW_ICON: Record<ViewKind, typeof LayoutList> = {
  list: LayoutList,
  board: Columns,
  calendar: CalendarDays,
  timeline: GanttChart,
};

export function ViewBar({
  listId,
  myId,
  active,
  activeViewId,
  onApply,
  onActiveViewIdChange,
}: {
  listId: string;
  myId: string;
  active: ActiveViewState;
  activeViewId: string | null;
  onApply: (state: ActiveViewState, sourceId: string | null) => void;
  onActiveViewIdChange: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const { data: views = [] } = useQuery({
    queryKey: ["task_views", listId],
    queryFn: () => listTaskViews(listId),
  });

  const myViews = views.filter((v) => v.owner_id === myId);
  const sharedViews = views.filter((v) => v.owner_id !== myId && v.is_shared);
  const pinned = [...myViews.filter((v) => v.pinned), ...sharedViews];
  const unpinned = myViews.filter((v) => !v.pinned);

  const [saveOpen, setSaveOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["task_views", listId] });

  const apply = (v: TaskView) => {
    onApply(
      {
        view: v.view,
        group_by: v.group_by,
        filters: v.filters,
        sort: v.sort,
      },
      v.id,
    );
  };

  const applyPreset = (p: Preset) => {
    onApply(p.state, p.id);
  };

  const togglePin = useMutation({
    mutationFn: (v: TaskView) =>
      updateTaskView(v.id, { pinned: !v.pinned }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const setDefault = useMutation({
    mutationFn: (v: TaskView) => updateTaskView(v.id, { is_default: true, pinned: true }),
    onSuccess: () => {
      toast.success("Default view set");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const clearDefault = useMutation({
    mutationFn: (v: TaskView) => updateTaskView(v.id, { is_default: false }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: TaskView) => deleteTaskView(v.id),
    onSuccess: () => {
      toast.success("View deleted");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {/* Built-in lenses */}
        {VIEW_PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = activeViewId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={cn(
                "h-7 px-2.5 text-xs rounded-md border flex items-center gap-1.5 transition",
                isActive
                  ? "bg-accent text-accent-foreground border-accent"
                  : "border-border hover:bg-muted",
              )}
              title="Built-in lens"
            >
              <Icon className="h-3.5 w-3.5" /> {p.label}
            </button>
          );
        })}

        {pinned.length > 0 && <span className="h-4 w-px bg-border mx-1" />}

        {pinned.map((v) => {
          const Icon = VIEW_ICON[v.view];
          const isActive = activeViewId === v.id;
          const shared = v.owner_id !== myId;
          return (
            <button
              key={v.id}
              onClick={() => apply(v)}
              className={cn(
                "h-7 px-2.5 text-xs rounded-md border flex items-center gap-1.5 transition group",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted",
              )}
              title={shared ? "Shared view" : "Your view"}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate max-w-[10rem]">{v.name}</span>
              {v.is_default && <Star className="h-3 w-3 fill-current" />}
              {shared && <Users2 className="h-3 w-3 opacity-70" />}
            </button>
          );
        })}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setSaveOpen(true)}
        >
          <Bookmark className="h-3.5 w-3.5" /> Save view
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setAiOpen(true)}
        >
          <Sparkles className="h-3.5 w-3.5" /> Describe a view
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <ChevronDown className="h-3.5 w-3.5" /> All views
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">Your views</DropdownMenuLabel>
            {myViews.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No saved views yet.
              </div>
            )}
            {myViews.map((v) => {
              const Icon = VIEW_ICON[v.view];
              return (
                <DropdownMenuItem
                  key={v.id}
                  onClick={() => apply(v)}
                  className="flex items-center gap-2"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{v.name}</span>
                  {v.is_default && <Star className="h-3 w-3 fill-current text-amber-500" />}
                  {v.is_shared && <Users2 className="h-3 w-3 opacity-60" />}
                  {activeViewId === v.id && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              );
            })}
            {sharedViews.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Shared with you</DropdownMenuLabel>
                {sharedViews.map((v) => {
                  const Icon = VIEW_ICON[v.view];
                  return (
                    <DropdownMenuItem
                      key={v.id}
                      onClick={() => apply(v)}
                      className="flex items-center gap-2"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="flex-1 truncate">{v.name}</span>
                      <Users2 className="h-3 w-3 opacity-60" />
                    </DropdownMenuItem>
                  );
                })}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setManageOpen(true)}>
              <MoreHorizontal className="h-3.5 w-3.5" /> Manage views…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        listId={listId}
        state={active}
        onSaved={(v) => {
          refresh();
          onActiveViewIdChange(v.id);
        }}
      />

      <AiDescribeDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        listId={listId}
        onSaved={(v) => {
          refresh();
          onApply(
            { view: v.view, group_by: v.group_by, filters: v.filters, sort: v.sort },
            v.id,
          );
        }}
      />

      <ManageViewsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        views={myViews}
        onTogglePin={(v) => togglePin.mutate(v)}
        onSetDefault={(v) => (v.is_default ? clearDefault.mutate(v) : setDefault.mutate(v))}
        onToggleShared={(v) =>
          updateTaskView(v.id, { is_shared: !v.is_shared }).then(refresh).catch(
            (e) => toast.error(e instanceof Error ? e.message : "Failed"),
          )
        }
        onRename={(v, name) =>
          updateTaskView(v.id, { name }).then(refresh).catch(
            (e) => toast.error(e instanceof Error ? e.message : "Failed"),
          )
        }
        onDelete={(v) => {
          if (confirm(`Delete view "${v.name}"?`)) remove.mutate(v);
        }}
      />
    </>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  listId,
  state,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  listId: string;
  state: ActiveViewState;
  onSaved: (v: TaskView) => void;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      createTaskView({
        list_id: listId,
        name: name.trim(),
        view: state.view,
        group_by: state.group_by,
        filters: state.filters,
        sort: state.sort,
        is_shared: shared,
        is_default: makeDefault,
        pinned: true,
      }),
    onSuccess: (v) => {
      toast.success("View saved");
      onSaved(v);
      onOpenChange(false);
      setName("");
      setShared(false);
      setMakeDefault(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save current view</DialogTitle>
          <DialogDescription>
            Captures the current type, grouping, filters and sort.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My focus this week"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Share with list collaborators</div>
              <div className="text-xs text-muted-foreground">
                Private to you by default.
              </div>
            </div>
            <Switch checked={shared} onCheckedChange={setShared} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Set as default</div>
              <div className="text-xs text-muted-foreground">
                Opens automatically when you visit this list.
              </div>
            </div>
            <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiDescribeDialog({
  open,
  onOpenChange,
  listId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  listId: string;
  onSaved: (v: TaskView) => void;
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ViewDraft | null>(null);
  const [shared, setShared] = useState(false);

  const generate = useMutation({
    mutationFn: () => describeView({ data: { description: text.trim() } }),
    onSuccess: (d) => setDraft(d),
    onError: (e) => toast.error(e instanceof Error ? e.message : "AI failed"),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("No draft");
      return createTaskView({
        list_id: listId,
        name: draft.name,
        view: draft.view,
        group_by: draft.group_by,
        filters: draft.filters,
        sort: draft.sort,
        is_shared: shared,
        pinned: true,
      });
    },
    onSuccess: (v) => {
      toast.success("View created");
      onSaved(v);
      onOpenChange(false);
      setText("");
      setDraft(null);
      setShared(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Describe a view
          </DialogTitle>
          <DialogDescription>
            Plain language. We'll draft a view and you confirm before saving. Counts
            against your AI allowance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. High-priority tasks due this week, grouped by stage"
            rows={3}
          />
          {!draft ? (
            <Button
              disabled={text.trim().length < 3 || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? "Drafting…" : "Generate draft"}
            </Button>
          ) : (
            <div className="rounded-md border border-border p-3 space-y-2 text-sm">
              <div className="font-medium">{draft.name}</div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>View: {draft.view}</div>
                <div>Group by: {draft.group_by}</div>
                <div>Sort: {draft.sort.key}</div>
                <div>
                  Filters: priority {draft.filters.priority}, status {draft.filters.status},
                  due {draft.filters.due}, assigned {draft.filters.assigned}, outcome{" "}
                  {draft.filters.outcome}
                </div>
                {draft.rationale && (
                  <div className="pt-1 italic">{draft.rationale}</div>
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={shared} onCheckedChange={setShared} />
                  Share with list collaborators
                </label>
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {draft && (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save view
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageViewsDialog({
  open,
  onOpenChange,
  views,
  onTogglePin,
  onSetDefault,
  onToggleShared,
  onRename,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  views: TaskView[];
  onTogglePin: (v: TaskView) => void;
  onSetDefault: (v: TaskView) => void;
  onToggleShared: (v: TaskView) => void;
  onRename: (v: TaskView, name: string) => void;
  onDelete: (v: TaskView) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage views</DialogTitle>
          <DialogDescription>Pin, default, share, rename or delete your saved views.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {views.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              You haven't saved any views yet.
            </div>
          )}
          {views.map((v) => {
            const Icon = VIEW_ICON[v.view];
            const renaming = renamingId === v.id;
            return (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded-md border border-border p-2"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                {renaming ? (
                  <Input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameText.trim()) {
                        onRename(v, renameText.trim());
                        setRenamingId(null);
                      } else if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-7"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setRenamingId(v.id);
                      setRenameText(v.name);
                    }}
                    className="flex-1 text-left text-sm truncate hover:underline"
                  >
                    {v.name}
                  </button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onTogglePin(v)}
                  title={v.pinned ? "Unpin" : "Pin to bar"}
                >
                  {v.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onSetDefault(v)}
                  title={v.is_default ? "Clear default" : "Set as default"}
                >
                  {v.is_default ? (
                    <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
                  ) : (
                    <StarOff className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onToggleShared(v)}
                  title={v.is_shared ? "Make private" : "Share with collaborators"}
                >
                  <Users2 className={cn("h-3.5 w-3.5", v.is_shared && "text-primary")} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => onDelete(v)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
