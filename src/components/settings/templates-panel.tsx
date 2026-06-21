import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
  type Template,
  type TemplateKind,
} from "@/lib/templates";

export function TemplatesPanel({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates", businessId],
    queryFn: () => listTemplates(businessId),
  });

  const [kind, setKind] = useState<TemplateKind>("note");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["templates", businessId] });

  const add = useMutation({
    mutationFn: () => createTemplate({ business_id: businessId, kind, name: name.trim(), body }),
    onSuccess: () => {
      setName("");
      setBody("");
      invalidate();
      toast.success("Template saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No templates yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {templates.map((t) => (
            <TemplateRow key={t.id} t={t} onChange={invalidate} />
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          add.mutate();
        }}
        className="space-y-2 rounded-lg border border-border p-3"
      >
        <div className="flex gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="task">Task</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Textarea
          placeholder="Body, markdown for notes, plain title/description for tasks"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={add.isPending || !name.trim()}>
          <Plus className="h-4 w-4 mr-1" />
          {add.isPending ? "Saving…" : "Add template"}
        </Button>
      </form>
    </div>
  );
}

function TemplateRow({ t, onChange }: { t: Template; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [body, setBody] = useState(t.body);

  const save = useMutation({
    mutationFn: () => updateTemplate(t.id, { name: name.trim(), body }),
    onSuccess: () => {
      setEditing(false);
      onChange();
      toast.success("Updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteTemplate(t.id),
    onSuccess: () => {
      onChange();
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <li className="px-3 py-2 text-sm space-y-2">
      {editing ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-1 justify-end">
            <Button size="icon" variant="ghost" onClick={() => setEditing(false)}>
              <X className="h-4 w-4" />
            </Button>
            <Button size="icon" onClick={() => save.mutate()} disabled={save.isPending}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground w-12">{t.kind}</span>
          <span className="flex-1 truncate">{t.name}</span>
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete template "${t.name}"?`)) del.mutate();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      )}
    </li>
  );
}
