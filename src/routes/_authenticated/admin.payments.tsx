import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import {
  listPaddleWebhooks,
  listSubscriptionRows,
} from "@/lib/payments-diagnostic.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/payments")({
  component: PaymentsDiagnostic,
});

type Env = "sandbox" | "live";

function PaymentsDiagnostic() {
  const { isAdmin, isLoading } = useIsPlatformAdmin();
  const [env, setEnv] = useState<Env>("sandbox");

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Checking access…</div>;
  }
  if (!isAdmin) return <Navigate to="/today" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Payments diagnostic</h1>
            <p className="text-sm text-muted-foreground">
              Last 20 webhook events and subscription rows. Use to confirm Paddle scenarios end to end.
            </p>
          </div>
        </div>
        <Tabs value={env} onValueChange={(v) => setEnv(v as Env)}>
          <TabsList>
            <TabsTrigger value="sandbox">Test</TabsTrigger>
            <TabsTrigger value="live">Live</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Webhook events</h2>
        <WebhooksTable env={env} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Subscription rows</h2>
        <SubscriptionsTable env={env} />
      </section>
    </div>
  );
}

function WebhooksTable({ env }: { env: Env }) {
  const fn = useServerFn(listPaddleWebhooks);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin", "payments", "webhooks", env],
    queryFn: () => fn({ data: { environment: env } }),
  });

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${data?.length ?? 0} events`}
        </span>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {error && (
        <div className="p-3 text-sm text-destructive">{(error as Error).message}</div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(n.occurred_at).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs">{n.event_type}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      n.status === "delivered"
                        ? "default"
                        : n.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {n.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{n.attempts}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {n.payload_summary}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  No webhook events yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SubscriptionsTable({ env }: { env: Env }) {
  const fn = useServerFn(listSubscriptionRows);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin", "payments", "subs", env],
    queryFn: () => fn({ data: { environment: env } }),
  });

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${data?.length ?? 0} rows`}
        </span>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {error && (
        <div className="p-3 text-sm text-destructive">{(error as Error).message}</div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Period end</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Sub ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.user_email ?? r.user_id.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.product_id}
                  <div className="text-muted-foreground">{r.price_id}</div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.status === "active" || r.status === "trialing"
                        ? "default"
                        : r.status === "past_due"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                  {r.cancel_at_period_end && (
                    <div className="text-[10px] text-muted-foreground mt-1">cancels at period end</div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{r.quantity ?? 1}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {r.current_period_end
                    ? new Date(r.current_period_end).toLocaleDateString()
                    : "-"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.updated_at).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">
                  {r.paddle_subscription_id}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                  No subscription rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
