/*
 * FlossChat supporter tiers. Browser-safe: shared by the server (prices,
 * grants) and the support page (labels, prices shown).
 *
 * A tier comes from everything paid for a Twitch account, minus refunds:
 *   Sanctioned  $5   (badge id 'supporter', the original hand badge)
 *   Suvy        $10
 *   Top Suvy    $20
 * Payments add up: moving up costs the difference to the next tier. A badge
 * the owner gave for free counts as if its tier's price had been paid.
 * The first FOUNDER_LIMIT people with a standing paid tier (gifts count) also
 * get the Founder badge; the owner's account has the Owner badge and every
 * other one, free.
 */

export const SUPPORTER_TIER_IDS = ['supporter', 'suvy', 'top-suvy'] as const;
export type SupporterTierId = (typeof SUPPORTER_TIER_IDS)[number];

export type SupporterTier = {
  readonly id: SupporterTierId;
  /** The name people see ("Sanctioned", "Suvy", "Top Suvy"). */
  readonly name: string;
  /** Total paid (USD cents) that reaches this tier. */
  readonly priceCents: number;
};

export const SUPPORTER_TIERS: readonly SupporterTier[] = [
  { id: 'supporter', name: 'Sanctioned', priceCents: 500 },
  { id: 'suvy', name: 'Suvy', priceCents: 1000 },
  { id: 'top-suvy', name: 'Top Suvy', priceCents: 2000 },
];

/** The first this many supporters also get the Founder badge. */
export const FOUNDER_LIMIT = 25;

/** Never charge less than this for a step up (PayPal and Stripe minimums). */
export const MIN_TIER_STEP_CENTS = 100;

export function isSupporterTierId(value: unknown): value is SupporterTierId {
  return typeof value === 'string' && (SUPPORTER_TIER_IDS as readonly string[]).includes(value);
}

export function supporterTier(id: SupporterTierId): SupporterTier {
  return SUPPORTER_TIERS.find((tier) => tier.id === id)!;
}

/** 0, 1, 2 for the tiers in order; -1 for none. */
export function tierRank(id: SupporterTierId | null | undefined): number {
  return id ? SUPPORTER_TIER_IDS.indexOf(id) : -1;
}

/** The tier a total (paid plus free credit) reaches, or null under $5. */
export function tierForCents(cents: number): SupporterTierId | null {
  let reached: SupporterTierId | null = null;
  for (const tier of SUPPORTER_TIERS) if (cents >= tier.priceCents) reached = tier.id;
  return reached;
}

/** The higher of two tiers. */
export function higherTier(a: SupporterTierId | null, b: SupporterTierId | null): SupporterTierId | null {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * What it costs to reach `target` from `creditCents` (paid, plus the price of
 * a tier given for free), or null when that tier (or a higher one) is
 * already reached. Never under MIN_TIER_STEP_CENTS.
 */
export function tierStepCents(target: SupporterTierId, creditCents: number): number | null {
  const price = supporterTier(target).priceCents;
  if (creditCents >= price) return null;
  return Math.max(MIN_TIER_STEP_CENTS, price - Math.max(0, Math.floor(creditCents)));
}

/** Prices to reach each tier from this credit (null = already have it). */
export type SupporterTierPrices = Readonly<Record<SupporterTierId, number | null>>;

export function tierPrices(creditCents: number): SupporterTierPrices {
  return {
    supporter: tierStepCents('supporter', creditCents),
    suvy: tierStepCents('suvy', creditCents),
    'top-suvy': tierStepCents('top-suvy', creditCents),
  };
}

/** What a Twitch account holds, as the support page and /badges show it. */
export type SupporterStanding = {
  readonly tier: SupporterTierId | null;
  readonly founder: boolean;
  readonly owner: boolean;
  /** Prices to reach each tier from here (null = already have it). */
  readonly prices: SupporterTierPrices;
};
