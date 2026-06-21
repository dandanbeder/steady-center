import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: "Google" | "Microsoft";
  calendarName: string;
  busy?: boolean;
  onConfirm: (remove_events: boolean) => void;
};

/**
 * Confirmation dialog for disconnecting a synced calendar.
 *
 * Explains what happens (two-way sync stops) and asks the user to choose
 * whether to keep or remove the already-synced events.
 */
export function DisconnectCalendarDialog({
  open,
  onOpenChange,
  provider,
  calendarName,
  busy,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<"keep" | "remove">("keep");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {provider} calendar</DialogTitle>
          <DialogDescription>
            Two-way sync will stop for <span className="font-medium">{calendarName}</span>.
            New changes in {provider} won&apos;t appear in Heartbeat, and changes you
            make here won&apos;t be sent back.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "keep" | "remove")}
          className="space-y-3 py-2"
        >
          <Label
            htmlFor="keep"
            className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/40"
          >
            <RadioGroupItem id="keep" value="keep" className="mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-medium">Keep synced events in Heartbeat</div>
              <div className="text-xs text-muted-foreground">
                Events stay on your calendar as local items you can edit here.
              </div>
            </div>
          </Label>
          <Label
            htmlFor="remove"
            className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/40"
          >
            <RadioGroupItem id="remove" value="remove" className="mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-medium">Remove synced events</div>
              <div className="text-xs text-muted-foreground">
                Delete the events imported from this calendar. Your original
                events in {provider} are not affected.
              </div>
            </div>
          </Label>
        </RadioGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onConfirm(mode === "remove")}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
