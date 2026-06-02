import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/lib/password.functions";

function strengthIssue(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return "Must include a letter and a number";
  return null;
}

export function ChangePasswordSection() {
  const change = useServerFn(changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      change({ data: { current_password: current, new_password: next } }),
    onSuccess: () => {
      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Couldn't update"),
  });

  const issue = next ? strengthIssue(next) : null;
  const mismatch = !!confirm && next !== confirm;
  const ready =
    !!current && !!next && !!confirm && !issue && !mismatch && !mut.isPending;

  return (
    <section>
      <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
        <KeyRound className="h-4 w-4" /> Change password
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        We'll verify your current password before saving the new one.
      </p>
      <form
        className="space-y-3 max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) mut.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cur-pw">Current password</Label>
          <Input
            id="cur-pw"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input
            id="new-pw"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {issue && <p className="text-xs text-destructive">{issue}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-pw">Confirm new password</Label>
          <Input
            id="cf-pw"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && (
            <p className="text-xs text-destructive">Passwords don't match</p>
          )}
        </div>
        <Button type="submit" disabled={!ready}>
          {mut.isPending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </section>
  );
}
