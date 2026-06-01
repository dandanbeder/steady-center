import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { listMyInvitations, requestAccess } from "@/lib/invitations.functions";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export function MyInvitationsBanner() {
  const qc = useQueryClient();
  const list = useServerFn(listMyInvitations);
  const req = useServerFn(requestAccess);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => list(),
  });

  // Resolve invitation tokens (RLS lets the invitee read their own row).
  useEffect(() => {
    const ids = (query.data ?? []).map((i) => i.id);
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase.from("invitations").select("id, token").in("id", ids);
      if (data) {
        const map: Record<string, string> = {};
        for (const row of data) map[row.id] = row.token;
        setTokens(map);
      }
    })();
  }, [query.data]);

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
            {items.map((i) => {
              const token = tokens[i.id];
              return (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">
                    <strong>{i.business_name}</strong>
                    <span className="text-muted-foreground"> · {i.proposed_role}</span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => token && mut.mutate(token)}
                    disabled={!token || mut.isPending}
                  >
                    Request access
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
