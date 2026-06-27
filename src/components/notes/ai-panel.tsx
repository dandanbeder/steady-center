import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  ListChecks,
  Wand2,
  Tags,
  Compass,
  Mic,
  MicOff,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useServerFn } from "@tanstack/react-start";
import {
  summarizeNote,
  organizeBrainDump,
  suggestNoteMeta,
  extractActions,
  guideMe,
  cleanupTranscript,
} from "@/lib/notes-ai.functions";
import { updateNote, type Note } from "@/lib/notes";
import { createTask, createFolder, listLists, listFolders, type TaskPriority } from "@/lib/tasks";
import { supabase } from "@/integrations/supabase/client";
import { addTag } from "@/lib/item-tags";

type ExtractedAction = {
  title: string;
  due_at: string | null;
  priority: TaskPriority;
};

type DialogState =
  | { kind: "none" }
  | { kind: "summary"; text: string }
  | {
      kind: "organize";
      title: string;
      body_markdown: string;
      checklist: string[];
    }
  | {
      kind: "suggest";
      title: string;
      folder: { id: string | null; name: string };
      people: string[];
    }
  | { kind: "extract"; actions: ExtractedAction[] }
  | {
      kind: "guide";
      next_steps_markdown: string;
      big_item: {
        title: string;
        subtasks: Array<{ title: string; due_at: string | null }>;
      } | null;
    }
  | { kind: "voice" };

export function AIPanel({
  note,
  onChanged,
}: {
  note: Note;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<DialogState>({ kind: "none" });

  const fnSummarize = useServerFn(summarizeNote);
  const fnOrganize = useServerFn(organizeBrainDump);
  const fnSuggest = useServerFn(suggestNoteMeta);
  const fnExtract = useServerFn(extractActions);
  const fnGuide = useServerFn(guideMe);

  const run = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
    setBusy(label);
    try {
      return await p;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI request failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" /> AI assistant
      </div>
      <div className="flex flex-wrap gap-2">
        <AiBtn
          icon={Sparkles}
          label="Summarize"
          loading={busy === "summary"}
          onClick={async () => {
            const r = await run("summary", fnSummarize({ data: { noteId: note.id, includeAttachments: true } }));
            if (r) setDlg({ kind: "summary", text: r.markdown });
          }}
        />
        <AiBtn
          icon={Wand2}
          label="Organize"
          loading={busy === "organize"}
          onClick={async () => {
            if (!note.body.trim()) {
              toast.error("Add some text first.");
              return;
            }
            const r = await run(
              "organize",
              fnOrganize({ data: { rawText: note.body } }),
            );
            if (r) setDlg({ kind: "organize", ...r });
          }}
        />
        <AiBtn
          icon={Tags}
          label="Suggest"
          loading={busy === "suggest"}
          onClick={async () => {
            const r = await run("suggest", fnSuggest({ data: { noteId: note.id } }));
            if (r) setDlg({ kind: "suggest", ...r });
          }}
        />
        <AiBtn
          icon={ListChecks}
          label="Extract tasks"
          loading={busy === "extract"}
          onClick={async () => {
            const r = await run("extract", fnExtract({ data: { noteId: note.id } }));
            if (r) {
              if (r.actions.length === 0) {
                toast.info("No action items found.");
                return;
              }
              setDlg({ kind: "extract", actions: r.actions });
            }
          }}
        />
        <AiBtn
          icon={Compass}
          label="Guide me"
          loading={busy === "guide"}
          onClick={async () => {
            const r = await run("guide", fnGuide({ data: { noteId: note.id } }));
            if (r) setDlg({ kind: "guide", ...r });
          }}
        />
        <AiBtn
          icon={Mic}
          label="Voice"
          loading={false}
          onClick={() => setDlg({ kind: "voice" })}
        />
      </div>

      {/* === Dialogs === */}
      <SummaryDialog
        open={dlg.kind === "summary"}
        text={dlg.kind === "summary" ? dlg.text : ""}
        onClose={() => setDlg({ kind: "none" })}
        onAppend={async (md) => {
          await updateNote(note.id, {
            body: note.body + (note.body ? "\n\n" : "") + "## Summary\n\n" + md,
          });
          onChanged();
          setDlg({ kind: "none" });
          toast.success("Summary added to note");
        }}
      />

      <OrganizeDialog
        open={dlg.kind === "organize"}
        data={dlg.kind === "organize" ? dlg : null}
        onClose={() => setDlg({ kind: "none" })}
        onAccept={async (title, body) => {
          await updateNote(note.id, { title, body });
          onChanged();
          setDlg({ kind: "none" });
          toast.success("Note cleaned up");
        }}
      />

      <SuggestDialog
        open={dlg.kind === "suggest"}
        note={note}
        data={dlg.kind === "suggest" ? dlg : null}
        onClose={() => setDlg({ kind: "none" })}
        onApplied={() => {
          onChanged();
          setDlg({ kind: "none" });
        }}
      />

      <ExtractDialog
        open={dlg.kind === "extract"}
        note={note}
        actions={dlg.kind === "extract" ? dlg.actions : []}
        onClose={() => setDlg({ kind: "none" })}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["note-linked-tasks", note.id] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
          setDlg({ kind: "none" });
        }}
      />

      <GuideDialog
        open={dlg.kind === "guide"}
        note={note}
        data={dlg.kind === "guide" ? dlg : null}
        onClose={() => setDlg({ kind: "none" })}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["note-linked-tasks", note.id] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
          setDlg({ kind: "none" });
        }}
      />

      <VoiceDialog
        open={dlg.kind === "voice"}
        onClose={() => setDlg({ kind: "none" })}
        onAppend={async (text) => {
          await updateNote(note.id, {
            body: note.body + (note.body ? "\n\n" : "") + text,
          });
          onChanged();
          setDlg({ kind: "none" });
          toast.success("Transcript added");
        }}
        onAcceptCleaned={async (title, body) => {
          await updateNote(note.id, {
            title: note.title || title,
            body: note.body + (note.body ? "\n\n" : "") + body,
          });
          onChanged();
          setDlg({ kind: "none" });
          toast.success("Cleaned transcript added");
        }}
        cleanupFn={cleanupTranscript}
      />
    </div>
  );
}

function AiBtn({
  icon: Icon,
  label,
  loading,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={loading}
      className="h-8"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5 mr-1.5" />
      )}
      {label}
    </Button>
  );
}

// ---------- Dialogs ----------

function SummaryDialog({
  open,
  text,
  onClose,
  onAppend,
}: {
  open: boolean;
  text: string;
  onClose: () => void;
  onAppend: (md: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Summary</DialogTitle>
          <DialogDescription>Preview only, nothing saved yet.</DialogDescription>
        </DialogHeader>
        <div className="prose prose-sm max-w-none max-h-[60vh] overflow-y-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button onClick={() => onAppend(text)}>
            <Check className="h-4 w-4 mr-1" /> Append to note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrganizeDialog({
  open,
  data,
  onClose,
  onAccept,
}: {
  open: boolean;
  data: { title: string; body_markdown: string; checklist: string[] } | null;
  onClose: () => void;
  onAccept: (title: string, body: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Initialize when opening
  if (open && data && title === "" && body === "") {
    const checklistMd =
      data.checklist.length > 0
        ? "\n\n## Checklist\n" + data.checklist.map((c) => `- [ ] ${c}`).join("\n")
        : "";
    setTitle(data.title);
    setBody(data.body_markdown + checklistMd);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setTitle("");
          setBody("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cleaned-up note</DialogTitle>
          <DialogDescription>
            Preview, replaces the current title and body when you accept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[40vh] font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button onClick={() => onAccept(title, body)}>
            <Check className="h-4 w-4 mr-1" /> Replace note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestDialog({
  open,
  note,
  data,
  onClose,
  onApplied,
}: {
  open: boolean;
  note: Note;
  data: {
    title: string;
    folder: { id: string | null; name: string };
    people: string[];
  } | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [applyTitle, setApplyTitle] = useState(true);
  const [applyFolder, setApplyFolder] = useState(true);
  const [selectedPeople, setSelectedPeople] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState(false);

  if (open && data && Object.keys(selectedPeople).length === 0 && data.people.length > 0) {
    const init: Record<string, boolean> = {};
    data.people.forEach((p) => (init[p] = true));
    setSelectedPeople(init);
  }

  const apply = async () => {
    if (!data) return;
    setWorking(true);
    try {
      const patch: Record<string, string | null> = {};
      if (applyTitle && data.title && data.title !== note.title) {
        patch.title = data.title;
      }
      if (applyFolder) {
        if (data.folder.id) {
          patch.folder_id = data.folder.id;
        } else if (data.folder.name && note.business_id) {
          await createFolder({ business_id: note.business_id, name: data.folder.name });
          // refetch folder id
          const { data: f } = await supabase
            .from("folders")
            .select("id")
            .is("deleted_at", null)
            .eq("business_id", note.business_id)
            .eq("name", data.folder.name)
            .maybeSingle();
          if (f?.id) patch.folder_id = f.id;
        }
      }
      if (Object.keys(patch).length > 0) {
        await updateNote(note.id, patch as never);
      }
      const chosen = Object.entries(selectedPeople).filter(([, v]) => v).map(([k]) => k);
      if (chosen.length > 0 && note.business_id) {
        for (const email of chosen) {
          try {
            await addTag({
              item_type: "note",
              item_id: note.id,
              business_id: note.business_id,
              tagged_email: email,
            });
          } catch {
            /* ignore duplicates */
          }
        }
      }
      toast.success("Applied");
      onApplied();
      setSelectedPeople({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelectedPeople({});
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggestions</DialogTitle>
          <DialogDescription>Pick what to apply.</DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-4 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox
                checked={applyTitle}
                onCheckedChange={(c) => setApplyTitle(!!c)}
              />
              <div>
                <div className="font-medium">Title</div>
                <div className="text-muted-foreground">{data.title || "-"}</div>
              </div>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox
                checked={applyFolder}
                onCheckedChange={(c) => setApplyFolder(!!c)}
              />
              <div>
                <div className="font-medium">Folder</div>
                <div className="text-muted-foreground">
                  {data.folder.id ? data.folder.name : `Create new: ${data.folder.name}`}
                </div>
              </div>
            </label>
            {data.people.length > 0 && (
              <div>
                <div className="font-medium mb-1">Tag people</div>
                <div className="space-y-1">
                  {data.people.map((p) => (
                    <label key={p} className="flex items-center gap-2">
                      <Checkbox
                        checked={!!selectedPeople[p]}
                        onCheckedChange={(c) =>
                          setSelectedPeople((s) => ({ ...s, [p]: !!c }))
                        }
                      />
                      <span className="text-muted-foreground">{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={working}>
            {working ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtractDialog({
  open,
  note,
  actions,
  onClose,
  onCreated,
}: {
  open: boolean;
  note: Note;
  actions: ExtractedAction[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [items, setItems] = useState<Array<ExtractedAction & { include: boolean }>>(
    [],
  );
  const [listId, setListId] = useState<string>("");
  const [working, setWorking] = useState(false);

  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });

  const scopedLists = lists.filter((l) => {
    const f = folders.find((f) => f.id === l.folder_id);
    return f && (!note.business_id || f.business_id === note.business_id);
  });

  if (open && items.length === 0 && actions.length > 0) {
    setItems(actions.map((a) => ({ ...a, include: true })));
    if (!listId && scopedLists[0]) setListId(scopedLists[0].id);
  }

  const submit = async () => {
    const chosen = items.filter((i) => i.include);
    if (chosen.length === 0) {
      toast.error("Select at least one action.");
      return;
    }
    if (!listId) {
      toast.error("Pick a list to add tasks to.");
      return;
    }
    setWorking(true);
    try {
      for (const it of chosen) {
        await supabase.from("tasks").insert({
          list_id: listId,
          business_id: note.business_id,
          title: it.title,
          status: "todo",
          priority: it.priority,
          due_at: it.due_at,
          position: 0,
          owner_id: (await supabase.auth.getUser()).data.user!.id,
          source_note_id: note.id,
          source_type: "note",
        } as never);
      }
      toast.success(`Created ${chosen.length} task${chosen.length === 1 ? "" : "s"}`);
      setItems([]);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setItems([]);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Extract action items</DialogTitle>
          <DialogDescription>
            Edit, then confirm to create real tasks linked to this note.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Add to list:</span>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger className="h-8 w-60 text-xs">
                <SelectValue placeholder="Pick a list" />
              </SelectTrigger>
              <SelectContent>
                {scopedLists.map((l) => {
                  const f = folders.find((f) => f.id === l.folder_id);
                  return (
                    <SelectItem key={l.id} value={l.id}>
                      {f?.name ? `${f.name} / ` : ""}
                      {l.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="flex items-start gap-2 border border-border rounded-md p-2">
              <Checkbox
                checked={it.include}
                onCheckedChange={(c) =>
                  setItems((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, include: !!c } : x)),
                  )
                }
              />
              <div className="flex-1 space-y-1.5">
                <Input
                  value={it.title}
                  onChange={(e) =>
                    setItems((arr) =>
                      arr.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)),
                    )
                  }
                  className="h-8 text-sm"
                />
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={it.due_at ? it.due_at.slice(0, 10) : ""}
                    onChange={(e) =>
                      setItems((arr) =>
                        arr.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                due_at: e.target.value ? `${e.target.value}T12:00:00.000Z` : null,
                              }
                            : x,
                        ),
                      )
                    }
                    className="h-7 text-xs w-40"
                  />
                  <Select
                    value={it.priority}
                    onValueChange={(v) =>
                      setItems((arr) =>
                        arr.map((x, i) =>
                          i === idx ? { ...x, priority: v as TaskPriority } : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={working || !listId}>
            {working ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            Create tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuideDialog({
  open,
  note,
  data,
  onClose,
  onCreated,
}: {
  open: boolean;
  note: Note;
  data: {
    next_steps_markdown: string;
    big_item: {
      title: string;
      subtasks: Array<{ title: string; due_at: string | null }>;
    } | null;
  } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [items, setItems] = useState<Array<{ title: string; due_at: string | null; include: boolean }>>([]);
  const [listId, setListId] = useState<string>("");
  const [working, setWorking] = useState(false);

  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const scopedLists = lists.filter((l) => {
    const f = folders.find((f) => f.id === l.folder_id);
    return f && (!note.business_id || f.business_id === note.business_id);
  });

  if (open && items.length === 0 && data?.big_item?.subtasks?.length) {
    setItems(data.big_item.subtasks.map((s) => ({ ...s, include: true })));
    if (!listId && scopedLists[0]) setListId(scopedLists[0].id);
  }

  const createSubtasks = async () => {
    const chosen = items.filter((i) => i.include);
    if (chosen.length === 0 || !listId) return;
    setWorking(true);
    try {
      for (const it of chosen) {
        await supabase.from("tasks").insert({
          list_id: listId,
          business_id: note.business_id,
          title: it.title,
          status: "todo",
          priority: "normal",
          due_at: it.due_at ? `${it.due_at}T12:00:00.000Z` : null,
          position: 0,
          owner_id: (await supabase.auth.getUser()).data.user!.id,
          source_note_id: note.id,
          source_type: "note",
        } as never);
      }
      toast.success(`Created ${chosen.length} task${chosen.length === 1 ? "" : "s"}`);
      setItems([]);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  const appendSteps = async () => {
    if (!data) return;
    await updateNote(note.id, {
      body:
        note.body +
        (note.body ? "\n\n" : "") +
        "## Next steps\n\n" +
        data.next_steps_markdown,
    });
    onCreated();
    toast.success("Next steps added to note");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setItems([]);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>What to do next</DialogTitle>
          <DialogDescription>Preview, nothing saved until you confirm.</DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {data.next_steps_markdown}
              </ReactMarkdown>
            </div>

            {data.big_item && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-sm">
                  <span className="font-medium">Break down: </span>
                  <span className="text-muted-foreground">{data.big_item.title}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Add subtasks to list:</span>
                  <Select value={listId} onValueChange={setListId}>
                    <SelectTrigger className="h-7 w-60 text-xs">
                      <SelectValue placeholder="Pick a list" />
                    </SelectTrigger>
                    <SelectContent>
                      {scopedLists.map((l) => {
                        const f = folders.find((f) => f.id === l.folder_id);
                        return (
                          <SelectItem key={l.id} value={l.id}>
                            {f?.name ? `${f.name} / ` : ""}
                            {l.name}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  {items.map((it, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Checkbox
                        checked={it.include}
                        onCheckedChange={(c) =>
                          setItems((arr) =>
                            arr.map((x, i) => (i === idx ? { ...x, include: !!c } : x)),
                          )
                        }
                      />
                      <Input
                        value={it.title}
                        onChange={(e) =>
                          setItems((arr) =>
                            arr.map((x, i) =>
                              i === idx ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        className="h-7 text-xs flex-1"
                      />
                      <Input
                        type="date"
                        value={it.due_at ?? ""}
                        onChange={(e) =>
                          setItems((arr) =>
                            arr.map((x, i) =>
                              i === idx ? { ...x, due_at: e.target.value || null } : x,
                            ),
                          )
                        }
                        className="h-7 w-36 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={working}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <Button variant="outline" onClick={appendSteps} disabled={working}>
            Append steps to note
          </Button>
          {data?.big_item && (
            <Button onClick={createSubtasks} disabled={working || !listId || items.length === 0}>
              {working ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
              Create subtasks
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Voice ----------

type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function VoiceDialog({
  open,
  onClose,
  onAppend,
  onAcceptCleaned,
  cleanupFn,
}: {
  open: boolean;
  onClose: () => void;
  onAppend: (text: string) => Promise<void>;
  onAcceptCleaned: (title: string, body: string) => Promise<void>;
  cleanupFn: typeof cleanupTranscript;
}) {
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const [recRef, setRecRef] = useState<SpeechRecognitionLike | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState<{ title: string; body_markdown: string } | null>(null);
  const fnCleanup = useServerFn(cleanupFn);

  const SR = getSpeechRecognition();

  const start = () => {
    if (!SR) {
      toast.error("Voice input not supported in this browser.");
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || "en-US";
    r.onresult = (ev) => {
      let chunk = "";
      for (let i = 0; i < ev.results.length; i++) {
        chunk += ev.results[i][0].transcript;
      }
      setTranscript((t) => (t ? t + " " : "") + chunk.trim());
    };
    r.onerror = (e) => {
      toast.error(`Mic error: ${e.error}`);
      setRecording(false);
    };
    r.onend = () => setRecording(false);
    r.start();
    setRecRef(r);
    setRecording(true);
  };

  const stop = () => {
    recRef?.stop();
    setRecording(false);
  };

  const runCleanup = async () => {
    if (!transcript.trim()) return;
    setCleaning(true);
    try {
      const r = await fnCleanup({ data: { transcript } });
      setCleaned(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setCleaning(false);
    }
  };

  const reset = () => {
    setTranscript("");
    setCleaned(null);
    setRecording(false);
    recRef?.stop();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Voice to note</DialogTitle>
          <DialogDescription>
            Dictate, then optionally let AI clean it up. Nothing saves until you confirm.
          </DialogDescription>
        </DialogHeader>

        {!SR && (
          <div className="text-sm text-destructive">
            Voice input is not supported in this browser. Try Chrome or Edge.
          </div>
        )}

        <div className="space-y-3">
          <div className="flex gap-2">
            {recording ? (
              <Button onClick={stop} variant="destructive" size="sm">
                <MicOff className="h-4 w-4 mr-1" /> Stop
              </Button>
            ) : (
              <Button onClick={start} size="sm" disabled={!SR}>
                <Mic className="h-4 w-4 mr-1" /> {transcript ? "Resume" : "Start"}
              </Button>
            )}
            {transcript && (
              <Button onClick={() => setTranscript("")} variant="ghost" size="sm">
                Clear
              </Button>
            )}
          </div>

          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your transcript will appear here…"
            className="min-h-[20vh] text-sm"
          />

          {cleaned && (
            <div className="border border-border rounded-md p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Cleaned version
              </div>
              <Input
                value={cleaned.title}
                onChange={(e) => setCleaned({ ...cleaned, title: e.target.value })}
              />
              <Textarea
                value={cleaned.body_markdown}
                onChange={(e) =>
                  setCleaned({ ...cleaned, body_markdown: e.target.value })
                }
                className="min-h-[20vh] text-sm font-mono"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          {!cleaned ? (
            <>
              <Button
                variant="outline"
                onClick={() => onAppend(transcript)}
                disabled={!transcript.trim() || recording}
              >
                Append raw
              </Button>
              <Button onClick={runCleanup} disabled={!transcript.trim() || cleaning || recording}>
                {cleaning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                AI clean-up
              </Button>
            </>
          ) : (
            <Button onClick={() => onAcceptCleaned(cleaned.title, cleaned.body_markdown)}>
              <Check className="h-4 w-4 mr-1" /> Append cleaned
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
