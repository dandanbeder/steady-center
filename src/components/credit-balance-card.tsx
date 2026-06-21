import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BellRing, Coins, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { getCreditBalance, setLowBalanceThreshold } from "@/lib/credits.functions";

// Lazy: dialog only ships when the user clicks Top up.
const TopUpDialog = lazy(() =>
  import("@/components/topup-dialog").then((m) => ({ default: m.TopUpDialog })),
);

function fmtDate(d: string | null | undefined): string {
  if (!d) return ",";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CreditBalanceCard() {
  const getBalance = useServerFn(getCreditBalance);
  const setThreshold = useServerFn(setLowBalanceThreshold);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["credit-balance"],
    queryFn: () => getBalance(),
    staleTime: 30_000,
  });

  const [thresholdDraft, setThresholdDraft] = useState<string>("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);

  // Auto-open the picker when AI is hard-stopped, so the user lands on the
  // exact next step instead of a dead-end banner.
  useEffect(() => {
    if (q.data?.paused) setTopupOpen(true);
  }, [q.data?.paused]);

  // Refetch when the user returns from a successful checkout (?topup=success).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("topup") === "success") {
      // Webhook may land seconds after redirect, poll briefly.
      const poll = (attempt = 0) => {
        qc.invalidateQueries({ queryKey: ["credit-balance"] });
        if (attempt < 4) setTimeout(() => poll(attempt + 1), 2000);
      };
      poll();
      toast.success("Thanks! Your credits will appear in a moment.");
      params.delete("topup");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", next);
    }
  }, [qc]);


  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" /> AI credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  const b = q.data;
  if (!b) return null;

  const allowancePct =
    b.allowanceCap > 0 ? Math.min(100, Math.round((b.allowance / b.allowanceCap) * 100)) : 0;

  const handleSaveThreshold = async () => {
    const n = Number(thresholdDraft);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter a non-negative number");
      return;
    }
    setSavingThreshold(true);
    try {
      await setThreshold({ data: { threshold: Math.round(n) } });
      toast.success("Low-balance alert updated");
      setThresholdDraft("");
      await qc.invalidateQueries({ queryKey: ["credit-balance"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update threshold");
    } finally {
      setSavingThreshold(false);
    }
  };

  const lowBalance =
    !b.paused && b.total > 0 && b.total <= (b.lowThreshold ?? 0);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" /> AI credits
              </CardTitle>
              <CardDescription>
                {b.pooled ? "Pooled at the team account · " : ""}1 credit ≈ $0.0025 of model
                cost. Allowance refills on your billing anniversary; purchased credits roll
                for 12 months.
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums">{b.total}</div>
              <div className="text-xs text-muted-foreground">credits available</div>
              <Button
                size="sm"
                variant={b.paused || lowBalance ? "default" : "outline"}
                className="mt-2"
                onClick={() => setTopupOpen(true)}
              >
                <Plus className="h-4 w-4" /> Top up
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {b.paused && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                <div>
                  <div className="font-medium text-destructive">AI is paused</div>
                  <div className="text-muted-foreground">
                    You've used everything in your allowance and purchased balance. Top up
                    to resume, or wait until your next cycle.
                  </div>
                </div>
              </div>
              <Button size="sm" onClick={() => setTopupOpen(true)}>
                Top up now
              </Button>
            </div>
          )}

          {lowBalance && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
              <div className="flex items-start gap-2">
                <BellRing className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-300" />
                <div>
                  <div className="font-medium">Running low on credits</div>
                  <div className="text-muted-foreground">
                    You're at {b.total} credits (alert threshold: {b.lowThreshold}). A
                    top-up keeps AI features flowing.
                  </div>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTopupOpen(true)}>
                Top up
              </Button>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">This cycle's allowance</span>
              <span className="tabular-nums text-muted-foreground">
                {b.allowance} / {b.allowanceCap}
              </span>
            </div>
            <Progress value={allowancePct} />
            <div className="mt-1 text-xs text-muted-foreground">
              {b.cycleEnd ? `Resets on ${fmtDate(b.cycleEnd)}` : "Resets on your next billing date"}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">Purchased credits</span>
              <span className="tabular-nums text-muted-foreground">{b.purchased}</span>
            </div>
            {b.lots.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No purchased credits yet. Top-ups are added here and used after your
                allowance.
              </p>
            ) : (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {b.lots.map((lot) => (
                  <li key={lot.id} className="flex justify-between">
                    <span>Pack of {lot.credits_initial}</span>
                    <span>
                      {lot.credits_remaining} left · expires {fmtDate(lot.expires_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="low-balance-threshold" className="flex items-center gap-2 text-sm">
              <BellRing className="h-4 w-4" /> Low-balance alert
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="low-balance-threshold"
                type="number"
                min={0}
                className="max-w-[120px]"
                placeholder={String(b.lowThreshold)}
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                credits, alert me when I drop below this
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveThreshold}
                disabled={savingThreshold || thresholdDraft === ""}
              >
                {savingThreshold ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Current threshold: <strong>{b.lowThreshold}</strong>
              {b.lowAlertedAt ? ` · alerted on ${fmtDate(b.lowAlertedAt)}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>
      {topupOpen && (
        <Suspense fallback={null}>
          <TopUpDialog open={topupOpen} onOpenChange={setTopupOpen} />
        </Suspense>
      )}
    </>
  );
}

