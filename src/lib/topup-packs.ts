/**
 * AI credit top-up pack catalog. Shared by client + server.
 *
 * Sell price: $0.0035 / credit (0.35¢). Flat across all packs.
 * Pack sizes are deliberately LARGE so the Paddle transaction fee
 * (10% under $10, then 5% + flat fee) does not erode margin. We do not
 * offer small packs at this price point — the flat fee would invert margin.
 *
 * Internal cost economics (anchor, true cost per credit, margin %) are
 * confidential and live ONLY in the Super Admin AI Economics dashboard.
 * Do NOT surface them to customers anywhere in the app.
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
    priceId: "topup_5000",
    credits: 5_000,
    amountCents: 1750,
    currency: "usd",
    label: "Starter",
    blurb: "A solid runway of AI for everyday use.",
  },
  {
    priceId: "topup_10000",
    credits: 10_000,
    amountCents: 3500,
    currency: "usd",
    label: "Standard",
    highlight: true,
    blurb: "Most popular — plenty of headroom for a busy month.",
  },
  {
    priceId: "topup_25000",
    credits: 25_000,
    amountCents: 8750,
    currency: "usd",
    label: "Power",
    blurb: "For heavy AI users and meeting-rich weeks.",
  },
  {
    priceId: "topup_50000",
    credits: 50_000,
    amountCents: 17500,
    currency: "usd",
    label: "Pro stash",
    blurb: "Stock up and forget about it for months.",
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
