import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createBusiness } from "@/lib/businesses";

const COLORS = ["#7A8471", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#64748b"];

/** Single shared "Create an account" dialog used by the account switcher and by
 * AccountSelect's inline + Create action. Keeping one component avoids drift
 * between every entry point, every caller gets the same form, same defaults,
 * same error surfacing (real DB message, not a generic toast). */
export function CreateAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Receives the new business id so callers can immediately select it. */
  onCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [limitHit, setLimitHit] = useState(false);

  const mut = useMutation({
    mutationFn: async () => createBusiness(name.trim(), color),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["businesses"] });
      qc.invalidateQueries({ queryKey: ["businesses-all"] });
      toast.success("Account created");
      setName("");
      setColor(COLORS[0]);
      setLimitHit(false);
      onOpenChange(false);
      onCreated?.(id);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Failed to create account";
      // Plan cap → calm inline nudge with a link to billing, never a hard error.
      if (/upgrade/i.test(msg) && /account/i.test(msg)) {
        setLimitHit(true);
        return;
      }
      toast.error(msg);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setLimitHit(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create an account</DialogTitle>
        </DialogHeader>

        {limitHit ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">You've reached your plan's accounts.</p>
                  <p className="text-sm text-muted-foreground">
                    Upgrade to add more accounts within your space.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button asChild>
                <Link to="/billing" onClick={() => onOpenChange(false)}>
                  See plans
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              mut.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                autoFocus
                placeholder="e.g. Acme Co, Side Project, Personal"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                An account is a business or area inside your space. You can rename or delete it later.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Pick colour ${c}`}
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      color === c ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending || !name.trim()}>
                {mut.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
