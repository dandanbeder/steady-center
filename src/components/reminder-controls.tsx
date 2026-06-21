import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  addReminder,
  deleteReminder,
  listRemindersFor,
  LEAD_TIME_OPTIONS,
  type Reminder,
} from "@/lib/reminders";
import { Button } from "@/components/ui/button";

type Props = {
  refType: "event" | "task";
  refId: string;
  /** ISO time the reminder is anchored against (event.start_at or task.due_at). */
  anchorAt: string | null;
};

export function ReminderControls({ refType, refId, anchorAt }: Props) {
  const qc = useQueryClient();
  const { data: reminders = [] } = useQuery({
    queryKey: ["reminders", refType, refId],
    queryFn: () => listRemindersFor(refType, refId),
  });

  const [open, setOpen] = useState(false);

  const addMut = useMutation({
    mutationFn: (args: { lead_minutes: number }) => {
      if (!anchorAt) throw new Error("Set a date/time first");
      return addReminder({
        ref_type: refType,
        ref_id: refId,
        anchor_at: anchorAt,
        lead_minutes: args.lead_minutes,
        channel: "email",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders", refType, refId] });
      setOpen(false);
      toast.success("Reminder added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });


  const delMut = useMutation({
    mutationFn: (id: string) => deleteReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders", refType, refId] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bell className="h-4 w-4" />
        <span>Reminders</span>
      </div>

      {reminders.length === 0 && !open && (
        <p className="text-xs text-muted-foreground italic">No reminders set.</p>
      )}

      <ul className="space-y-1">
        {reminders.map((r: Reminder) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm"
          >
            <span>
              {new Date(r.remind_at).toLocaleString()} · {r.channel}
              {r.sent && <span className="ml-2 text-xs text-muted-foreground">(sent)</span>}
            </span>
            <button
              type="button"
              onClick={() => delMut.mutate(r.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap gap-1.5">
            {LEAD_TIME_OPTIONS.map((opt) => (
              <Button
                key={opt.minutes}
                type="button"
                size="sm"
                variant="outline"
                disabled={!anchorAt || addMut.isPending}
                onClick={() => addMut.mutate({ lead_minutes: opt.minutes })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Delivered by email.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={!anchorAt}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add reminder
        </Button>
      )}
      {!anchorAt && (
        <p className="text-xs text-muted-foreground">Set a date first to enable reminders.</p>
      )}
    </div>
  );
}
