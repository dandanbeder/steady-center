import { useState } from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TOPUP_PACKS,
  formatUsd,
  pricePerCreditCents,
  type TopUpPack,
} from "@/lib/topup-packs";

type Props = {
  /** Pre-open the dialog (used by the hard-stop banner). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger; if omitted the parent controls open state. */
  trigger?: React.ReactNode;
};

/**
 * Pack picker → Paddle.Checkout.open. The webhook does the actual crediting;
 * we just open the checkout. After a successful purchase the user returns
 * via successUrl and the credit-balance query refetches.
 */
export function TopUpDialog({ open, onOpenChange, trigger }: Props) {
  const { user } = useAuth();
  const { openCheckout, loading } = usePaddleCheckout();
  const [pendingPriceId, setPendingPriceId] = useState<string | null>(null);

  const handleBuy = async (pack: TopUpPack) => {
    if (!user?.id) {
      toast.error("Please sign in to purchase credits");
      return;
    }
    setPendingPriceId(pack.priceId);
    try {
      await openCheckout({
        priceId: pack.priceId,
        quantity: 1,
        customerEmail: user.email ?? undefined,
        customData: { userId: user.id },
        successUrl: `${window.location.origin}/billing?topup=success`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
    } finally {
      setPendingPriceId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" /> Top up AI credits
          </DialogTitle>
          <DialogDescription>
            Purchased credits roll for 12 months and survive plan changes. They're
            used after your monthly allowance.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {TOPUP_PACKS.map((pack) => {
            const isPending = pendingPriceId === pack.priceId;
            return (
              <Card
                key={pack.priceId}
                className={`relative p-4 ${
                  pack.highlight ? "border-primary ring-1 ring-primary/30" : ""
                }`}
              >
                {pack.highlight && (
                  <Badge className="absolute -top-2 right-3 gap-1">
                    <Sparkles className="h-3 w-3" /> Best value
                  </Badge>
                )}
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {pack.label}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {pack.credits.toLocaleString()}{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        credits
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold tabular-nums">
                      {formatUsd(pack.amountCents)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {pricePerCreditCents(pack).toFixed(2)}¢/credit
                    </div>
                  </div>
                </div>
                {pack.blurb && (
                  <p className="mt-2 text-xs text-muted-foreground">{pack.blurb}</p>
                )}
                <Button
                  className="mt-3 w-full"
                  variant={pack.highlight ? "default" : "outline"}
                  disabled={loading || isPending}
                  onClick={() => handleBuy(pack)}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Buy ${pack.credits.toLocaleString()} credits`
                  )}
                </Button>
              </Card>
            );
          })}
        </div>

        <DialogFooter className="text-xs text-muted-foreground sm:justify-start">
          Paid securely via our payment provider. Credits are added to your account
          the moment the payment completes.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
