import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  shareResource,
  revokeShare,
  updateShareRole,
  listShares,
  suggestShareTargets,
  type ResourceType,
  type ShareRole,
  type ShareGrantee,
} from "@/lib/shares.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
};

const ROLES: ShareRole[] = ["viewer", "commenter", "member", "admin"];

export function ShareDialog({ open, onOpenChange, resourceType, resourceId, resourceName }: Props) {
  const qc = useQueryClient();
  const _listShares = useServerFn(listShares);
  const _suggest = useServerFn(suggestShareTargets);
  const _share = useServerFn(shareResource);
  const _revoke = useServerFn(revokeShare);
  const _updateRole = useServerFn(updateShareRole);

  const { data: shares = [], isLoading } = useQuery({
    queryKey: ["shares", resourceType, resourceId],
    queryFn: () => _listShares({ data: { resourceType, resourceId } }),
    enabled: open,
  });

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<ShareRole>("member");
  const [busyOnly, setBusyOnly] = useState(false);
  const [canReshare, setCanReshare] = useState(false);
  const [canExport, setCanExport] = useState(false);


  const { data: suggestions = [] } = useQuery({
    queryKey: ["share-suggest", query],
    queryFn: () => _suggest({ data: { query } }),
    enabled: open,
  });

  const grant = useMutation({
    mutationFn: (granteeUserId: string) =>
      _share({ data: { resourceType, resourceId, granteeUserId, role, busyOnly, canReshare, canExport } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shares", resourceType, resourceId] });
      qc.invalidateQueries({ queryKey: ["shared-with-me"] });
      toast.success("Share added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantByEmail = useMutation({
    mutationFn: (email: string) =>
      _share({ data: { resourceType, resourceId, granteeEmail: email, role, busyOnly, canReshare, canExport } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shares", resourceType, resourceId] });
      setQuery("");
      toast.success("Share added");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const revoke = useMutation({
    mutationFn: (shareId: string) => _revoke({ data: { shareId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shares", resourceType, resourceId] });
      qc.invalidateQueries({ queryKey: ["shared-with-me"] });
    },
  });

  const setRoleMut = useMutation({
    mutationFn: (vars: { shareId: string; role: ShareRole }) =>
      _updateRole({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares", resourceType, resourceId] }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share "{resourceName}"</DialogTitle>
          <DialogDescription>
            People you add will see this {resourceType}
            {["folder", "list", "calendar"].includes(resourceType)
              ? " and everything inside it"
              : ""}
            . Nothing else in your workspace is shared.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <div>
              <Label className="text-xs">Email or name</Label>
              <Input
                placeholder="name@example.com"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => query.includes("@") && grantByEmail.mutate(query.trim())}
              disabled={!query.includes("@") || grantByEmail.isPending}
            >
              {grantByEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
            </Button>
          </div>

          {resourceType === "calendar" && (
            <div className="flex items-center justify-between rounded border p-2">
              <Label htmlFor="busy-only" className="text-sm">Busy-only (hide details)</Label>
              <Switch id="busy-only" checked={busyOnly} onCheckedChange={setBusyOnly} />
            </div>
          )}

          {suggestions.length > 0 && query && (
            <div className="rounded border max-h-40 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between"
                  onClick={() => grant.mutate(s.id)}
                >
                  <span>{s.name ?? s.email}</span>
                  <span className="text-muted-foreground text-xs">{s.email}</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t pt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              People with access
            </p>
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && shares.length === 0 && (
              <p className="text-sm text-muted-foreground">No one else has access yet.</p>
            )}
            <ul className="space-y-1">
              {shares.map((g: ShareGrantee) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{g.full_name ?? g.email ?? "Unknown"}</div>
                    {g.full_name && g.email && (
                      <div className="text-xs text-muted-foreground truncate">{g.email}</div>
                    )}
                  </div>
                  <Select
                    value={g.role}
                    onValueChange={(v) => setRoleMut.mutate({ shareId: g.id, role: v as ShareRole })}
                  >
                    <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {g.details?.busy_only ? <Badge variant="secondary" className="text-xs">busy-only</Badge> : null}
                  <Button size="icon" variant="ghost" onClick={() => revoke.mutate(g.id)} aria-label="Revoke">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
