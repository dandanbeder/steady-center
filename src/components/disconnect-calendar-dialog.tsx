import { Button } from "@/components/ui/button";
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
  onConfirm: () => void;
};

/**
 * Confirmation dialog for disconnecting a synced calendar.
 *
 * Two-way sync stops, OAuth access for the provider is revoked server-side,
 * and the row returns to its "Connect" state. Already-synced events are kept
 * as local items by default — we don't ask the user to decide unless a future
 * requirement explicitly asks for it.
 */
export function DisconnectCalendarDialog({
  open,
  onOpenChange,
  provider,
  calendarName,
  busy,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {provider} calendar</DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            <span className="block">
              Two-way sync will stop for{" "}
              <span className="font-medium text-foreground">{calendarName}</span>.
              New changes in {provider} won&apos;t appear in Heartbeat, and changes
              you make here won&apos;t be sent back.
            </span>
            <span className="block text-xs">
              Already-synced events stay on your calendar as local items you can
              edit. Your original events in {provider} are not affected.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
