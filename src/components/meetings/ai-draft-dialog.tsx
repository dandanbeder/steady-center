import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listBusinesses } from "@/lib/businesses";
import { listFolders, listLists } from "@/lib/tasks";
import { listOutcomes } from "@/lib/outcomes";

export type DraftDecision = { text: string; outcome_id: string | null };
export type DraftTask = {
  text: string;
  owner_label: string | null;
  due_at: string | null;
  business_id: string | null;
  list_id: string | null;
  outcome_id: string | null;
  accepted: boolean;
};

export type AIDraft = {
  summary: string;
  decisions: DraftDecision[];
  tasks: DraftTask[];
};

export function AIDraftDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  defaultBusinessId,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: AIDraft | null;
  setDraft: (d: AIDraft) => void;
  defaultBusinessId: string | null;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const { data: outcomes = [] } = useQuery({
    queryKey: ["outcomes", "all"],
    queryFn: () => listOutcomes(),
  });

  if (!draft) return null;

  const update = (patch: Partial<AIDraft>) => setDraft({ ...draft, ...patch });
  const updTask = (i: number, patch: Partial<DraftTask>) =>
    update({ tasks: draft.tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const updDec = (i: number, patch: Partial<DraftDecision>) =>
    update({ decisions: draft.decisions.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });

  const acceptedCount = draft.tasks.filter((t) => t.accepted).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review AI draft</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Nothing is saved until you confirm. Edit anything below.
          </p>
        </DialogHeader>

        <div className="space-y-6">
          <section>
            <Label>Summary</Label>
            <Textarea
              value={draft.summary}
              onChange={(e) => update({ summary: e.target.value })}
              className="min-h-[100px]"
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <Label>Decisions</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  update({ decisions: [...draft.decisions, { text: "", outcome_id: null }] })
                }
              >
                + Add
              </Button>
            </div>
            {draft.decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decisions.</p>
            ) : (
              <ul className="space-y-2">
                {draft.decisions.map((d, i) => (
                  <li key={i} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={d.text}
                        onChange={(e) => updDec(i, { text: e.target.value })}
                        placeholder="Decision"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          update({ decisions: draft.decisions.filter((_, idx) => idx !== i) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Link to outcome (optional)</Label>
                      <Select
                        value={d.outcome_id ?? "_none"}
                        onValueChange={(v) => updDec(i, { outcome_id: v === "_none" ? null : v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">None</SelectItem>
                          {outcomes.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <Label>
                Action items ({acceptedCount}/{draft.tasks.length} will become tasks)
              </Label>
            </div>
            {draft.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No action items.</p>
            ) : (
              <ul className="space-y-2">
                {draft.tasks.map((t, i) => {
                  const businessId = t.business_id ?? defaultBusinessId;
                  const availFolders = folders.filter(
                    (f) => !businessId || f.business_id === businessId,
                  );
                  const availLists = lists.filter((l) =>
                    availFolders.some((f) => f.id === l.folder_id),
                  );
                  return (
                    <li
                      key={i}
                      className={`border rounded-lg p-3 space-y-2 ${
                        t.accepted ? "border-primary/40 bg-primary/5" : "border-border opacity-70"
                      }`}
                    >
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1.5"
                          checked={t.accepted}
                          onChange={(e) => updTask(i, { accepted: e.target.checked })}
                        />
                        <Input
                          value={t.text}
                          onChange={(e) => updTask(i, { text: e.target.value })}
                          className="flex-1"
                        />
                      </label>
                      {t.accepted && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
                          <div>
                            <Label className="text-xs text-muted-foreground">Owner</Label>
                            <Input
                              value={t.owner_label ?? ""}
                              onChange={(e) => updTask(i, { owner_label: e.target.value || null })}
                              placeholder="e.g. Sam"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Due</Label>
                            <Input
                              type="date"
                              value={t.due_at ? t.due_at.slice(0, 10) : ""}
                              onChange={(e) =>
                                updTask(i, {
                                  due_at: e.target.value
                                    ? new Date(e.target.value).toISOString()
                                    : null,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Space</Label>
                            <Select
                              value={businessId ?? "_personal"}
                              onValueChange={(v) =>
                                updTask(i, {
                                  business_id: v === "_personal" ? null : v,
                                  list_id: null,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_personal">Personal</SelectItem>
                                {businesses.map((b) => (
                                  <SelectItem key={b.id} value={b.id}>
                                    {b.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">List</Label>
                            <Select
                              value={t.list_id ?? "_none"}
                              onValueChange={(v) =>
                                updTask(i, { list_id: v === "_none" ? null : v })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Uncategorised" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">Uncategorised</SelectItem>
                                {availLists.map((l) => {
                                  const f = folders.find((x) => x.id === l.folder_id);
                                  return (
                                    <SelectItem key={l.id} value={l.id}>
                                      {f?.name} / {l.name}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">Outcome (optional)</Label>
                            <Select
                              value={t.outcome_id ?? "_none"}
                              onValueChange={(v) =>
                                updTask(i, { outcome_id: v === "_none" ? null : v })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">None</SelectItem>
                                {outcomes
                                  .filter((o) => !businessId || o.business_id === businessId || o.business_id === null)
                                  .map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      {o.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm & create {acceptedCount} task{acceptedCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function newDraftFrom(
  draft: { summary: string; decisions: string[]; action_items: Array<{ text: string; owner?: string | null; due_at?: string | null }> },
  defaultBusinessId: string | null,
): AIDraft {
  return {
    summary: draft.summary,
    decisions: draft.decisions.map((t) => ({ text: t, outcome_id: null })),
    tasks: draft.action_items.map((a) => ({
      text: a.text,
      owner_label: a.owner ?? null,
      due_at: a.due_at ?? null,
      business_id: defaultBusinessId,
      list_id: null,
      outcome_id: null,
      accepted: true,
    })),
  };
}
