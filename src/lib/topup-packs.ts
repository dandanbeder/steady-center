/**
 * AI credit top-up pack catalog. Shared by client + server.
 *
 * Pricing rules (anchored to CREDIT_ANCHOR_MICROS = 0.25¢ true cost / credit):
 *   • Per-credit sell price floor: 0.35¢ (1.4× anchor) — never go below.
 *   • Per-credit sell price target: ~0.75¢ (3× anchor) on the smallest pack.
 *   • Larger packs reward volume but always stay ≥ floor.
 *
 * Pack sizes are deliberately large so the Paddle fee (10% under $10, then
 * 5% + $0.50) doesn't eat the margin. No $1 / 100-credit packs.
 *
 * Packs roll 12 months from purchase, survive plan changes, and are
 * available on EVERY tier (Free included).
 */

export type TopUpPack = {
  /** Paddle external price_id (also the key in the webhook TOPUP_PACKS map). */
  priceId: string;
  credits: number;
  /** Amount in cents (must match the Paddle price). */
  amountCents: number;
  currency: "usd";
  label: string;
  /** Short marketing tagline. */
  blurb?: string;
  highlight?: boolean;
};

export const TOPUP_PACKS: ReadonlyArray<TopUpPack> = [
  {
    priceId: "topup_500",
    credits: 500,
    amountCents: 399,
    currency: "usd",
    label: "Starter",
    blurb: "Top up to keep going this cycle.",
  },
  {
    priceId: "topup_2000",
    credits: 2000,
    amountCents: 1399,
    currency: "usd",
    label: "Standard",
    blurb: "Roughly a month of heavy use.",
  },
  {
    priceId: "topup_5000",
    credits: 5000,
    amountCents: 2999,
    currency: "usd",
    label: "Power",
    highlight: true,
    blurb: "Best balance of price and headroom.",
  },
  {
    priceId: "topup_12000",
    credits: 12000,
    amountCents: 5999,
    currency: "usd",
    label: "Pro stash",
    blurb: "Lowest per-credit price.",
  },
] as const;

export const TOPUP_PACK_BY_PRICE: Record<string, TopUpPack> = Object.fromEntries(
  TOPUP_PACKS.map((p) => [p.priceId, p]),
);

export function pricePerCreditCents(p: TopUpPack): number {
  return p.amountCents / p.credits;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
