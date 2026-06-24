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

type TopUpMode = "personal" | "shared";

type Props = {
  /** Pre-open the dialog (used by the hard-stop banner). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger; if omitted the parent controls open state. */
  trigger?: React.ReactNode;
  /**
   * "shared" = owner buying into the team kitty (everyone on the team uses).
   * "personal" = anyone buying credits into their own private space.
   * The webhook keys credits on the buyer's userId, so this prop only
   * controls copy and the post-checkout redirect. The routing is implicit:
   * owner buy → kitty; member buy → that member's personal account.
   */
  mode?: TopUpMode;
  /** Where to redirect after success. Defaults to /billing?topup=success. */
  successUrl?: string;
};

export function TopUpDialog({
  open,
  onOpenChange,
  trigger,
  mode = "personal",
  successUrl,
}: Props) {
  const { user } = useAuth();
  const { openCheckout, loading } = usePaddleCheckout();
  const [pendingPriceId, setPendingPriceId] = useState<string | null>(null);

  const isShared = mode === "shared";

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
        customData: { userId: user.id, topupTarget: mode },
        successUrl:
          successUrl ??
          `${window.location.origin}/billing?topup=success&pool=${mode}`,
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
            <Coins className="h-5 w-5" />
            {isShared ? "Top up the shared team pool" : "Top up your own AI credits"}
          </DialogTitle>
          <DialogDescription>
            {isShared
              ? "Credits go into the shared team kitty, available to everyone on the team. They roll for 12 months and stay with the team."
              : "Credits go into your own private space, used only by you after the shared team pool runs out. They roll for 12 months and stay with you if you leave the team."}
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
