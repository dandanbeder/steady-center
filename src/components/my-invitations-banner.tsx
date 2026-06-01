import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { listMyInvitations, requestAccess } from "@/lib/invitations.functions";
import { Button } from "@/components/ui/button";

export function MyInvitationsBanner() {
  const qc = useQueryClient();
  const list = useServerFn(listMyInvitations);
  const req = useServerFn(requestAccess);

  const query = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => list(),
  });

  const mut = useMutation({
    mutationFn: (token: string) => req({ data: { token } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
      toast.success("Access requested");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const items = (query.data ?? []).filter((i) => !i.request_status);
  if (!items.length) return null;

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="text-sm font-medium">
            You've been invited to {items.length === 1 ? "an account" : `${items.length} accounts`}
          </div>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  <strong>{i.business_name}</strong>
                  <span className="text-muted-foreground"> · {i.proposed_role}</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => mut.mutate(i.token)}
                  disabled={mut.isPending}
                >
                  Request access
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
