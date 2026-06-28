import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: "Google" | "Microsoft";
  calendarName: string;
  busy?: boolean;
  /** When true, the dialog is for the whole provider account, not a single calendar. */
  accountLevel?: boolean;
  onConfirm: (opts: { removeEvents: boolean }) => void;
};

/**
 * Confirmation dialog for disconnecting a synced calendar (or whole account).
 *
 * Disconnecting stops two-way sync and removes the stored connection,
 * including any server-side OAuth tokens for that account. The user may
 * also choose to remove already-synced events from Heartbeat (POPIA:
 * revoke and erase).
 */
export function DisconnectCalendarDialog({
  open,
  onOpenChange,
  provider,
  calendarName,
  busy,
  accountLevel,
  onConfirm,
}: Props) {
  const [removeEvents, setRemoveEvents] = useState(true);
  useEffect(() => {
    if (open) setRemoveEvents(true);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Disconnect {accountLevel ? `${provider} account` : `${provider} calendar`}
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            <span className="block">
              Two-way sync will stop for{" "}
              <span className="font-medium text-foreground">{calendarName}</span>.
              {accountLevel
                ? ` All access tokens for ${provider} stored on our servers will be removed.`
                : ` Sync will stop for this calendar.`}{" "}
              Your original events in {provider} are not affected.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
          <Checkbox
            id="remove-events"
            checked={removeEvents}
            onCheckedChange={(v) => setRemoveEvents(v === true)}
            disabled={busy}
          />
          <div className="space-y-1">
            <Label htmlFor="remove-events" className="text-sm font-medium leading-tight cursor-pointer">
              Also delete the synced events from Heartbeat
            </Label>
            <p className="text-xs text-muted-foreground">
              Recommended for a full revoke. If you leave this off, already-synced
              events stay here as local items you can edit or delete later.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onConfirm({ removeEvents })}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
