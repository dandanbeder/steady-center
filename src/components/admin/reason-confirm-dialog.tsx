import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** If set, user must type this exact string to confirm. */
  confirmToken?: string;
  confirmTokenLabel?: string;
  /** When true (default) requires a non-empty reason of length >= 3. */
  requireReason?: boolean;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}

export function ReasonConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmToken,
  confirmTokenLabel = "Type to confirm",
  requireReason = true,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  onConfirm,
  children,
}: Props) {
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const tokenOk = !confirmToken || token.trim() === confirmToken.trim();
  const reasonOk = !requireReason || reason.trim().length >= 3;
  const close = (o: boolean) => {
    if (!o) {
      setReason("");
      setToken("");
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          {children}
          {confirmToken && (
            <div className="space-y-1">
              <Label>{confirmTokenLabel}</Label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={confirmToken}
                autoComplete="off"
              />
            </div>
          )}
          {requireReason && (
            <div className="space-y-1">
              <Label>Reason (recorded in the audit log)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Short note for the audit log…"
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!tokenOk || !reasonOk || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
