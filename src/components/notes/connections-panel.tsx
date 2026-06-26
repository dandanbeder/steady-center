import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Link2, Plus, X, CheckSquare, Users, Calendar, FileText, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listLinksFrom,
  listBacklinks,
  resolveLinks,
  createLink,
  deleteLink,
  type NoteLinkType,
} from "@/lib/note-links";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<NoteLinkType, typeof CheckSquare> = {
  task: CheckSquare,
  meeting: Users,
  event: Calendar,
  note: FileText,
};

export function ConnectionsPanel({
  noteId,
  businessId,
}: {
  noteId: string;
  businessId: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const linksQ = useQuery({
    queryKey: ["note-links", noteId],
    queryFn: async () => {
      const raw = await listLinksFrom(noteId);
      return resolveLinks(raw);
    },
  });
  const backQ = useQuery({
    queryKey: ["note-backlinks", noteId],
    queryFn: async () => {
      const raw = await listBacklinks("note", noteId);
      return resolveLinks(raw);
    },
  });

  const remove = async (id: string) => {
    try {
      await deleteLink(id);
      qc.invalidateQueries({ queryKey: ["note-links", noteId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["note-links", noteId] });
    qc.invalidateQueries({ queryKey: ["note-backlinks", noteId] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> Connections
        </h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          disabled={!businessId}
          title={businessId ? "Add a connection" : "Move this note into an account first"}
        >
          <Plus className="h-4 w-4 mr-1" /> Link
        </Button>
      </div>

      <div className="space-y-1.5">
        {(linksQ.data ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">No connections yet.</p>
        )}
        {(linksQ.data ?? []).map((l) => {
          const Icon = TYPE_ICON[l.to_type];
          return (
            <div
              key={l.id}
              className="flex items-center gap-2 text-sm bg-muted/40 rounded-md px-2 py-1.5"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[10px] uppercase text-muted-foreground tracking-wide w-14 shrink-0">
                {l.to_type}
              </span>
              {l.href ? (
                <Link to={l.href} className="flex-1 truncate hover:underline">
                  {l.label}
                </Link>
              ) : (
                <span className="flex-1 truncate text-muted-foreground italic">{l.label}</span>
              )}
              <button
                onClick={() => remove(l.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove link"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {(backQ.data ?? []).length > 0 && (
        <div className="pt-2">
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Referenced by
          </h4>
          <div className="space-y-1">
            {(backQ.data ?? []).map((l) => (
              <Link
                key={l.id}
                to="/notes"
                className="block text-sm text-muted-foreground hover:text-foreground hover:underline truncate"
              >
                <FileText className="h-3 w-3 inline mr-1.5" />
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <AddConnectionDialog
        open={open}
        onOpenChange={setOpen}
        noteId={noteId}
        businessId={businessId}
        onAdded={() => {
          refresh();
          setOpen(false);
        }}
      />
    </div>
  );
}

function AddConnectionDialog({
  open,
  onOpenChange,
  noteId,
  businessId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  noteId: string;
  businessId: string | null;
  onAdded: () => void;
}) {
  const [type, setType] = useState<NoteLinkType>("task");
  const [q, setQ] = useState("");

  const results = useQuery({
    queryKey: ["link-search", type, businessId, q],
    enabled: open && !!businessId,
    queryFn: async () => {
      if (!businessId) return [];
      const term = q.trim();
      const tbl = type === "task" ? "tasks" : type === "meeting" ? "meetings" : type === "event" ? "events" : "notes";
      let query = supabase
        .from(tbl)
        .select("id, title")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (term) query = query.ilike("title", `%${term}%`);
      if (type === "note") query = query.neq("id", noteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string }>;
    },
  });

  const add = async (toId: string) => {
    if (!businessId) return;
    try {
      await createLink({ from_note_id: noteId, business_id: businessId, to_type: type, to_id: toId });
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link this note to…</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Select value={type} onValueChange={(v) => setType(v as NoteLinkType)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="task">Task</SelectItem>
              <SelectItem value="meeting">Meeting</SelectItem>
              <SelectItem value="event">Event</SelectItem>
              <SelectItem value="note">Note</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${type}s…`}
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1 -mx-1">
          {(results.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground px-2 py-6 text-center">
              {q ? "No matches." : "Type to search, or pick a recent item below."}
            </p>
          )}
          {(results.data ?? []).map((r) => (
            <button
              key={r.id}
              onClick={() => add(r.id)}
              className={cn(
                "w-full text-left text-sm px-3 py-2 rounded-md hover:bg-muted",
              )}
            >
              {r.title || "Untitled"}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
