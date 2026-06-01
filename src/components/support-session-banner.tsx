import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  adminEndSupportSession,
  adminSetSupportSessionMode,
} from "@/lib/admin.functions";
import { useActiveSupportSession } from "@/hooks/use-support-session";

export function SupportSessionBanner() {
  const { data: session } = useActiveSupportSession();
  const qc = useQueryClient();
  const endFn = useServerFn(adminEndSupportSession);
  const modeFn = useServerFn(adminSetSupportSessionMode);

  const endMut = useMutation({
    mutationFn: () => endFn({ data: { session_id: session!.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const modeMut = useMutation({
    mutationFn: (mode: "read" | "write") =>
      modeFn({ data: { session_id: session!.id, mode } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  if (!session) return null;

  const isWrite = session.mode === "write";
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm border-b ${
        isWrite
          ? "bg-destructive text-destructive-foreground border-destructive"
          : "bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/40"
      }`}
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="font-medium">
        Viewing {session.target_name || session.target_email}'s account (admin support session,
        {isWrite ? " WRITE" : " read-only"})
      </span>
      <span className="opacity-70 text-xs truncate">— {session.reason}</span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant={isWrite ? "secondary" : "outline"}
          onClick={() => modeMut.mutate(isWrite ? "read" : "write")}
          disabled={modeMut.isPending}
        >
          Switch to {isWrite ? "read-only" : "write"}
        </Button>
        <Button
          size="sm"
          variant={isWrite ? "secondary" : "default"}
          onClick={() => endMut.mutate()}
          disabled={endMut.isPending}
        >
          End session
        </Button>
      </div>
    </div>
  );
}
