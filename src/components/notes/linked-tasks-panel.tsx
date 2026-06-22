import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { updateTask, type Task, type TaskStatus, STATUSES } from "@/lib/tasks";
import { updateNote, type Note } from "@/lib/notes";
import { format } from "date-fns";
import { CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

async function listTasksForNote(noteId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("source_note_id", noteId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

// Flip the matching `- [ ] <title>` checkbox line (case-insensitive, leading
// markers tolerant) to `- [x]` (or back to `- [ ]`). Returns the new body, or
// null if no matching line was found.
function reflectTaskStateInBody(body: string, title: string, done: boolean): string | null {
  if (!title.trim()) return null;
  const lines = body.split(/\r?\n/);
  const normalizedTitle = title.trim().toLowerCase();
  const reTask = /^(\s*[-*]\s*)\[([ xX])\]\s*(.+?)\s*$/;
  let hitIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(reTask);
    if (!m) continue;
    if (m[3].toLowerCase() === normalizedTitle) {
      hitIndex = i;
      break;
    }
  }
  if (hitIndex === -1) return null;
  const m = lines[hitIndex].match(reTask)!;
  const checked = m[2].toLowerCase() === "x";
  if (checked === done) return null;
  lines[hitIndex] = `${m[1]}[${done ? "x" : " "}] ${m[3]}`;
  return lines.join("\n");
}

export function LinkedTasksPanel({ note }: { note: Note }) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({
    queryKey: ["note-linked-tasks", note.id],
    queryFn: () => listTasksForNote(note.id),
  });

  if (tasks.length === 0) return null;

  const toggle = async (t: Task) => {
    const next: TaskStatus = t.status === "done" ? "todo" : "done";
    try {
      await updateTask(t.id, { status: next });
      // Reflect completion back onto a matching checkbox line in the note.
      const newBody = reflectTaskStateInBody(note.body, t.title, next === "done");
      if (newBody !== null) {
        try {
          await updateNote(note.id, { body: newBody });
          qc.invalidateQueries({ queryKey: ["notes"] });
        } catch {
          /* non-fatal: task status still updated */
        }
      }
      qc.invalidateQueries({ queryKey: ["note-linked-tasks", note.id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Linked tasks ({tasks.length})
      </div>
      <ul className="space-y-1">
        {tasks.map((t) => {
          const done = t.status === "done";
          const statusLabel = STATUSES.find((s) => s.value === t.status)?.label ?? t.status;
          return (
            <li
              key={t.id}
              className="flex items-start gap-2 text-sm group rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <button
                onClick={() => toggle(t)}
                className="mt-0.5 text-muted-foreground hover:text-foreground"
                aria-label={done ? "Mark as todo" : "Mark as done"}
              >
                {done ? (
                  <CheckSquare className="h-4 w-4" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <Link
                  to="/tasks"
                  className={
                    done
                      ? "line-through text-muted-foreground hover:underline"
                      : "hover:underline"
                  }
                >
                  {t.title}
                </Link>
                <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                  <span>{statusLabel}</span>
                  {t.due_at && (
                    <span>· due {format(new Date(t.due_at), "MMM d")}</span>
                  )}
                  <span>· {t.priority}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
