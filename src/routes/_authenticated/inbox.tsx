import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Inbox as InboxIcon, Check, Trash2, Sparkles, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  captureToInbox, deleteInbox, dismissInbox, listInbox, markInboxAccepted,
  updateInboxSuggestion, type InboxItem, type InboxType,
} from "@/lib/inbox";
import { suggestInboxItem } from "@/lib/inbox-ai.functions";
import { listBusinesses } from "@/lib/businesses";
import {
  createFolder, createList, createTask, listFolders, listLists,
} from "@/lib/tasks";
import { createNote } from "@/lib/notes";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const qc = useQueryClient();
  const [capture, setCapture] = useState("");
  const suggest = useServerFn(suggestInboxItem);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inbox", "pending"],
    queryFn: () => listInbox("pending"),
  });
  const { data: businesses = [] } = useQuery({ queryKey: ["businesses"], queryFn: listBusinesses });
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const { data: lists = [] } = useQuery({ queryKey: ["lists"], queryFn: listLists });

  const captureMut = useMutation({
    mutationFn: async (text: string) => {
      const item = await captureToInbox({ raw_text: text, source: "quick_add" });
      // fire-and-forget AI suggestion
      suggest({ data: { inbox_id: item.id, now: new Date().toISOString() } })
        .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }))
        .catch(() => {});
      return item;
    },
    onSuccess: () => {
      setCapture("");
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", "count"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Capture failed"),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <InboxIcon className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Capture now, triage later. Accept a suggestion to file it into the right module.
          </p>
        </div>
      </header>

      <div className="rounded-lg border bg-card p-3 flex gap-2">
        <Input
          placeholder="Capture anything — Enter to send to Inbox"
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && capture.trim()) captureMut.mutate(capture.trim());
          }}
        />
        <Button
          onClick={() => capture.trim() && captureMut.mutate(capture.trim())}
          disabled={!capture.trim() || captureMut.isPending}
        >
          Capture
        </Button>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <InboxIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Inbox zero. Anything you capture by mic or quick-add lands here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <InboxCard
              key={it.id}
              item={it}
              businesses={businesses}
              folders={folders}
              lists={lists}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({
  item, businesses, folders, lists,
}: {
  item: InboxItem;
  businesses: { id: string; name: string }[];
  folders: { id: string; name: string; business_id: string }[];
  lists: { id: string; name: string; folder_id: string }[];
}) {
  const qc = useQueryClient();
  const suggest = useServerFn(suggestInboxItem);
  const processed = !!item.ai_processed_at;

  const [type, setType] = useState<InboxType>((item.suggested_type as InboxType) || "task");
  const [title, setTitle] = useState(item.suggested_title || "");
  const [body, setBody] = useState(item.suggested_body || item.raw_text);
  const [bizId, setBizId] = useState<string>(item.suggested_business_id || "none");
  const [folderId, setFolderId] = useState<string>(item.suggested_folder_id || "none");
  const [listId, setListId] = useState<string>(item.suggested_list_id || "none");
  const [priority, setPriority] = useState<string>(item.suggested_priority || "normal");
  const [due, setDue] = useState<string>(
    item.suggested_due_at ? item.suggested_due_at.slice(0, 16) : "",
  );
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    if (item.ai_processed_at) {
      setType((item.suggested_type as InboxType) || "task");
      setTitle(item.suggested_title || "");
      setBody(item.suggested_body || item.raw_text);
      setBizId(item.suggested_business_id || "none");
      setFolderId(item.suggested_folder_id || "none");
      setListId(item.suggested_list_id || "none");
      setPriority(item.suggested_priority || "normal");
      setDue(item.suggested_due_at ? item.suggested_due_at.slice(0, 16) : "");
    }
  }, [item.ai_processed_at, item.id]);

  const filteredFolders = folders.filter((f) => bizId !== "none" && f.business_id === bizId);
  const filteredLists = lists.filter((l) => folderId !== "none" && l.folder_id === folderId);

  const reSuggest = async () => {
    setBusy(true);
    try {
      await suggest({ data: { inbox_id: item.id, now: new Date().toISOString() } });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    setBusy(true);
    try {
      const finalBiz = bizId === "none" ? null : bizId;
      const finalDueIso = due ? new Date(due).toISOString() : null;

      if (type === "task") {
        if (!finalBiz) throw new Error("Pick an account for tasks.");
        let fId = folderId === "none" ? null : folderId;
        if (!fId) {
          const existing = folders.find(
            (f) => f.business_id === finalBiz && f.name.toLowerCase() === "inbox",
          );
          if (existing) fId = existing.id;
          else {
            await createFolder({ business_id: finalBiz, name: "Inbox" });
            const fresh = await qc.fetchQuery({ queryKey: ["folders"], queryFn: listFolders });
            fId = fresh.find((f) => f.business_id === finalBiz && f.name.toLowerCase() === "inbox")?.id ?? null;
          }
        }
        if (!fId) throw new Error("Could not resolve folder.");
        let lId = listId === "none" ? null : listId;
        if (!lId || !lists.find((l) => l.id === lId && l.folder_id === fId)) {
          const inFolder = lists.find((l) => l.folder_id === fId);
          if (inFolder) lId = inFolder.id;
          else {
            await createList({ folder_id: fId, name: "Tasks" });
            const fresh = await qc.fetchQuery({ queryKey: ["lists"], queryFn: listLists });
            lId = fresh.find((l) => l.folder_id === fId)?.id ?? null;
          }
        }
        if (!lId) throw new Error("Could not resolve list.");
        await createTask({
          list_id: lId,
          business_id: finalBiz,
          title: title.trim() || "Untitled",
          description: body || null,
          priority: priority as never,
          due_at: finalDueIso,
        });
        await markInboxAccepted(item.id, { type: "task", id: lId });
      } else if (type === "note") {
        const fId = folderId === "none" ? null : folderId;
        const note = await createNote({
          business_id: finalBiz,
          folder_id: fId,
          title: title.trim() || "Untitled note",
          body: body || "",
          source: "inbox",
        });
        await markInboxAccepted(item.id, { type: "note", id: note.id });
      } else {
        // event
        if (!finalDueIso) throw new Error("Pick a start time for events.");
        // pick default calendar for biz (or first)
        const { data: cals } = await (supabase.from("calendars") as any)
          .select("id, business_id").limit(50);
        const cal = (cals ?? []).find((c: any) => c.business_id === finalBiz) ?? (cals ?? [])[0];
        if (!cal) throw new Error("No calendar available. Create one first.");
        const start = new Date(finalDueIso);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const { data: u } = await supabase.auth.getUser();
        const { data: ev, error } = await (supabase.from("events") as any)
          .insert({
            owner_id: u.user!.id,
            calendar_id: cal.id,
            business_id: finalBiz,
            title: title.trim() || "Untitled event",
            description: body || null,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            source: "inbox",
          })
          .select("id")
          .single();
        if (error) throw error;
        await markInboxAccepted(item.id, { type: "event", id: ev.id });
      }

      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", "count"] });
      qc.invalidateQueries();
      toast.success("Filed from Inbox");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    } finally {
      setBusy(false);
    }
  };

  const onDismiss = async () => {
    try {
      await dismissInbox(item.id);
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", "count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };
  const onDelete = async () => {
    try {
      await deleteInbox(item.id);
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", "count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveEdits = async () => {
    await updateInboxSuggestion(item.id, {
      suggested_type: type,
      suggested_title: title,
      suggested_body: body,
      suggested_business_id: bizId === "none" ? null : bizId,
      suggested_folder_id: folderId === "none" ? null : folderId,
      suggested_list_id: listId === "none" ? null : listId,
      suggested_priority: priority as never,
      suggested_due_at: due ? new Date(due).toISOString() : null,
    });
    qc.invalidateQueries({ queryKey: ["inbox"] });
    setEdit(false);
  };

  const bizName = businesses.find((b) => b.id === bizId)?.name;
  const folderName = folders.find((f) => f.id === folderId)?.name;
  const listName = lists.find((l) => l.id === listId)?.name;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words flex-1">{item.raw_text}</p>
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(item.created_at).toLocaleString()}
        </span>
      </div>

      {!processed ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Suggesting…
          <Button variant="ghost" size="sm" onClick={reSuggest} disabled={busy} className="ml-auto">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </div>
      ) : !edit ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" /> AI suggestion
            <Badge variant="secondary" className="text-xs capitalize">{type}</Badge>
            {priority && type === "task" && (
              <Badge variant="outline" className="text-xs capitalize">{priority}</Badge>
            )}
          </div>
          <div className="text-sm font-medium">{title || <em className="text-muted-foreground">No title</em>}</div>
          {body && body !== item.raw_text && (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">{body}</div>
          )}
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {bizName && <span>Account: {bizName}</span>}
            {folderName && <span>Folder: {folderName}</span>}
            {listName && <span>List: {listName}</span>}
            {due && <span>Due: {new Date(due).toLocaleString()}</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-md border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as InboxType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Account</Label>
              <Select value={bizId} onValueChange={(v) => { setBizId(v); setFolderId("none"); setListId("none"); }}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {businesses.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Folder</Label>
              <Select value={folderId} onValueChange={(v) => { setFolderId(v); setListId("none"); }} disabled={bizId === "none"}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filteredFolders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {type === "task" && (
              <div>
                <Label className="text-xs">List</Label>
                <Select value={listId} onValueChange={setListId} disabled={folderId === "none"}>
                  <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto</SelectItem>
                    {filteredLists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {type === "task" && (
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="col-span-2">
              <Label className="text-xs">{type === "event" ? "Starts" : "Due"}</Label>
              <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
            <Button size="sm" variant="secondary" onClick={saveEdits}>Save edits</Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={accept} disabled={busy || !processed}>
          <Check className="h-4 w-4 mr-1" /> Accept
        </Button>
        {!edit && processed && (
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Edit</Button>
        )}
        <Button size="sm" variant="ghost" onClick={reSuggest} disabled={busy}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-suggest
        </Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={onDismiss} title="Dismiss">
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
