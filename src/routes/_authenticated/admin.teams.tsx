import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Users, Search } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { adminListAllTeams } from "@/lib/admin-system.functions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const fn = useServerFn(adminListAllTeams);
  const { data = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["admin", "all-teams"],
    queryFn: () => fn(),
    enabled: !!isAdmin,
  });
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        (t.owner_email ?? "").toLowerCase().includes(s) ||
        (t.owner_full_name ?? "").toLowerCase().includes(s),
    );
  }, [data, q]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">All teams</h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide accounts (workspaces). Administer, never read private member work.
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team name, owner email…"
          className="pl-9"
        />
      </div>

      {rowsLoading ? (
        <div className="text-muted-foreground">Loading teams…</div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Owner plan</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs">
                    {t.owner_email ? (
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: t.owner_id }}
                        className="text-primary underline"
                      >
                        {t.owner_email}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t.owner_id.slice(0, 8)}</span>
                    )}
                    {t.owner_full_name && (
                      <div className="text-muted-foreground">{t.owner_full_name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.owner_plan === "team" ? "default" : "secondary"}>
                      {t.owner_plan}
                    </Badge>
                    {t.owner_plan_status && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {t.owner_plan_status}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {t.active_member_count}
                    <span className="text-xs text-muted-foreground"> / {t.member_count}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {t.archived_at ? (
                      <Badge variant="outline">archived</Badge>
                    ) : (
                      <Badge variant="secondary">active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    No teams match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="pt-2">
        <Link to="/admin" className="text-sm underline text-primary">← Back to admin home</Link>
      </div>
    </div>
  );
}
