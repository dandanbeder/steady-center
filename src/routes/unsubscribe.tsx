import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmUnsubscribe, getUnsubscribeInfo } from "@/lib/email-prefs.functions";

const search = z.object({ token: z.string().min(8).max(128).optional() });

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (raw) => search.parse(raw),
  component: UnsubscribePage,
  head: () => ({
    meta: [
      { title: "Unsubscribe · Heartbeat" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function UnsubscribePage() {
  const { token } = useSearch({ from: "/unsubscribe" });
  const lookup = useServerFn(getUnsubscribeInfo);
  const confirm = useServerFn(confirmUnsubscribe);

  const info = useQuery({
    queryKey: ["unsub", token],
    queryFn: () => lookup({ data: { token: token! } }),
    enabled: !!token,
    retry: false,
  });

  const m = useMutation({
    mutationFn: () => confirm({ data: { token: token! } }),
  });

  return (
    <main className="min-h-dvh flex items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Email preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && (
            <p className="text-sm text-muted-foreground">
              This link is missing its unsubscribe token. Please use the link from your email.
            </p>
          )}

          {token && info.isLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
            </p>
          )}

          {token && info.data && !info.data.valid && (
            <p className="text-sm text-muted-foreground">
              This unsubscribe link is invalid or has expired. If you'd still like to opt out,
              sign in and visit Settings → Notifications.
            </p>
          )}

          {token && info.data?.valid && !m.isSuccess && (
            <>
              <p className="text-sm">
                Unsubscribe <span className="font-medium">{info.data.email}</span> from Heartbeat
                product updates and weekly review emails?
              </p>
              <p className="text-xs text-muted-foreground">
                We'll still send essential account messages — password resets, security alerts,
                and billing notices.
              </p>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => m.mutate()}
                  disabled={m.isPending}
                  className="flex-1"
                >
                  {m.isPending ? "Unsubscribing…" : "Confirm unsubscribe"}
                </Button>
              </div>
              {info.data.alreadyOptedOut && (
                <p className="text-xs text-muted-foreground">
                  You're already opted out — confirming again is fine.
                </p>
              )}
            </>
          )}

          {m.isSuccess && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" /> You're unsubscribed.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                A confirmation has been emailed to you. You can re-enable product updates any
                time from Settings → Notifications.
              </p>
            </div>
          )}

          {m.isError && (
            <p className="text-sm text-destructive">
              Something went wrong. Please try again, or sign in and opt out from settings.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
