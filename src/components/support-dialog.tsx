import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { sendSupportEmail } from "@/lib/support.functions";

export function SupportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const send = useServerFn(sendSupportEmail);

  const defaultName = (user?.user_metadata?.full_name as string | undefined) ?? "";
  const defaultEmail = user?.email ?? "";

  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setEmail(defaultEmail);
      setMessage("");
      setSent(false);
    }
  }, [open, defaultName, defaultEmail]);

  const mut = useMutation({
    mutationFn: (vars: { name: string; email: string; message: string }) =>
      send({ data: vars }),
    onSuccess: () => setSent(true),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Couldn't send your message.";
      toast.error(msg);
    },
  });

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    message.trim().length >= 5 &&
    !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                Message sent
              </DialogTitle>
              <DialogDescription>
                Thanks, we've got your note. The team will reply to{" "}
                <span className="text-foreground">{email}</span> as soon as they can.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Contact support</DialogTitle>
              <DialogDescription>
                Tell us what's going on, we'll get back to you by email.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="support-name">Name</Label>
                <Input
                  id="support-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-email">Email</Label>
                <Input
                  id="support-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-message">How can we help?</Label>
                <Textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder="Describe what you were doing and what went wrong…"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => mut.mutate({ name, email, message })}
                disabled={!canSubmit}
              >
                {mut.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                    Sending…
                  </>
                ) : (
                  "Send message"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
