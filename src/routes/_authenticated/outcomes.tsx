import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Trophy, Archive, Trash2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  createOutcome,
  daysRemaining,
  deleteOutcome,
  listOutcomesWithProgress,
  updateOutcome,
  type OutcomeStatus,
  type OutcomeWithProgress,
} from "@/lib/outcomes";

export const Route = createFileRoute("/_authenticated/outcomes")({
  head: () => ({
    meta: [
      { title: "Outcomes · Heartbeat" },
      { name: "description", content: "Bigger goals that your tasks roll up into." },
    ],
  }),
  component: OutcomesPage,
});

function OutcomesPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveBusiness();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OutcomeWithProgress | null>(null);
  const [tab, setTab] = useState<OutcomeStatus>("active");

  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  // Personal + each business; if "all" view, fetch each scope so RLS filtering is clean
  const scopes = useMemo<Array<string | null>>(() => {
    if (activeId === ALL) return [null, ...businesses.map((b) => b.id)];
    return [activeId];
  }, [activeId, businesses]);

  const { data: outcomes = [], isLoading } = useQuery({
    queryKey: ["outcomes", activeId, businesses.map((b) => b.id).join(",")],
    queryFn: async () => {
      const lists = await Promise.all(scopes.map((s) => listOutcomesWithProgress(s)));
      return lists.flat();
    },
  });

  const bizName = (id: string | null) =>
    id ? (businesses.find((b) => b.id === id)?.name ?? "Account") : "Personal";

  const filtered = outcomes.filter((o) => o.status === tab);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" /> Outcomes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bigger goals your tasks roll up into. Quietly powerful.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New outcome
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OutcomeStatus)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="achieved">Achieved</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              {tab === "active"
                ? "No active outcomes yet. Name something you're working toward."
                : tab === "achieved"
                  ? "Nothing achieved here yet. Soon."
                  : "Nothing archived."}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((o) => (
                <OutcomeCard
                  key={o.id}
                  outcome={o}
                  bizName={bizName(o.business_id)}
                  onEdit={() => setEditing(o)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {creating && (
        <OutcomeDialog
          onClose={() => setCreating(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["outcomes"] })}
        />
      )}
      {editing && (
        <OutcomeDialog
          outcome={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["outcomes"] })}
        />
      )}
    </div>
  );
}

function OutcomeCard({
  outcome,
  bizName,
  onEdit,
}: {
  outcome: OutcomeWithProgress;
  bizName: string;
  onEdit: () => void;
}) {
  const days = daysRemaining(outcome.target_date);
  const dueLabel = (() => {
    if (days === null) return null;
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return "Due today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  })();
  const dueClass =
    days === null
      ? ""
      : days < 0
        ? "text-destructive"
        : days <= 7
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-base truncate">{outcome.name}</h3>
            <Badge variant="outline" className="text-[10px]">{bizName}</Badge>
            {outcome.status === "achieved" && (
              <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px] gap-1">
                <Trophy className="h-3 w-3" /> Achieved
              </Badge>
            )}
          </div>
          {outcome.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{outcome.description}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{outcome.done_tasks} of {outcome.total_tasks} tasks done</span>
          <span>{outcome.progress_pct}%</span>
        </div>
        <Progress value={outcome.progress_pct} />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={"inline-flex items-center gap-1 " + dueClass}>
          <CalendarClock className="h-3.5 w-3.5" />
          {outcome.target_date
            ? new Date(outcome.target_date).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              })
            : "No target date"}
          {dueLabel ? <span className="ml-1">· {dueLabel}</span> : null}
        </span>
        <Link
          to="/tasks"
          className="text-primary hover:underline"
        >
          View tasks →
        </Link>
      </div>
    </Card>
  );
}

function OutcomeDialog({
  outcome,
  onClose,
  onSaved,
}: {
  outcome?: OutcomeWithProgress;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!outcome;
  const { activeId } = useActiveBusiness();
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });

  const [name, setName] = useState(outcome?.name ?? "");
  const [description, setDescription] = useState(outcome?.description ?? "");
  const [targetDate, setTargetDate] = useState(outcome?.target_date ?? "");
  const [status, setStatus] = useState<OutcomeStatus>(outcome?.status ?? "active");
  const [businessId, setBusinessId] = useState<string>(
    outcome?.business_id ?? (activeId !== ALL ? activeId : ""),
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      if (isEdit) {
        await updateOutcome(outcome!.id, {
          name: name.trim(),
          description: description.trim() || null,
          target_date: targetDate || null,
          status,
        });
      } else {
        await createOutcome({
          business_id: businessId || null,
          name: name.trim(),
          description: description.trim() || null,
          target_date: targetDate || null,
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Outcome updated" : "Outcome created");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteOutcome(outcome!.id),
    onSuccess: () => {
      toast.success("Outcome deleted");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit outcome" : "New outcome"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Loyalty programme launch"
              autoFocus
            />
          </div>
          {!isEdit && (
            <div>
              <Label>Account</Label>
              <Select value={businessId || "__none"} onValueChange={(v) => setBusinessId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Personal</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does done look like?"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Target date</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            {isEdit && (
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as OutcomeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="achieved">
                      <span className="inline-flex items-center gap-1.5">
                        <Trophy className="h-3.5 w-3.5" /> Achieved
                      </span>
                    </SelectItem>
                    <SelectItem value="archived">
                      <span className="inline-flex items-center gap-1.5">
                        <Archive className="h-3.5 w-3.5" /> Archived
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {isEdit && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              onClick={() => {
                if (confirm("Delete this outcome? Linked tasks will be unlinked.")) del.mutate();
              }}
              disabled={del.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
