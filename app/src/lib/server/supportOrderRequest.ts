/*
 * The part of starting a supporter payment that PayPal and Stripe share:
 * a signed-in buyer, the amount, and who gets the badge.
 *  - forSelf: the signed-in Twitch account (read from the signed session
 *    cookie, never from the request body);
 *  - login: a gift, the Twitch name resolved here to its account ID;
 *  - neither: no badge, just support (any amount from $5 to $500).
 * A badge order names a tier (supporterTiers.ts). Its price is set here, never
 * by the browser: what is left to reach that tier from everything already
 * paid for the recipient (payments add up). A tier the recipient already has
 * (or is past) is refused.
 * Any amount ($5–$500, no tier) for a recipient pays that amount (at least
 * what Sanctioned still costs them) and adds up toward the tiers like any
 * payment; it names the best tier the new total reaches (the one already
 * held when it reaches nothing new), so it is open to someone who already
 * has a tier too. An older page that sends only an amount works the same.
 */
import type { ApiRequest } from './apiTypes';
import { fixedProviderClientKey } from '@/lib/server/fixedProviderProxy';
import { supporterStanding } from '@/lib/server/gxufyBadges';
import { readSession } from '@/lib/server/session';
import type { SupportOrderKind, SupportRecipient, SupporterStore } from '@/lib/server/supporterStore';
import {
  SUPPORT_MIN_CENTS,
  normalizeSupportAmountCents,
  normalizeSupportTwitchLogin,
} from '@/lib/supportPage';
import { SUPPORTER_TIER_IDS, isSupporterTierId, supporterTier, type SupporterTierId } from '@/lib/supporterTiers';
import { resolveSupportTwitchUser } from '@/api/twitch/support-user';

export type SupportOrderRequest = {
  amountCents: number;
  recipient: SupportRecipient | null;
  kind: SupportOrderKind;
  /** The tier bought (badge orders). */
  tier?: SupporterTierId;
};

export type SupportOrderRequestResult =
  | { ok: true; order: SupportOrderRequest }
  | { ok: false; status: number; error: string };

export function requestBody(req: ApiRequest): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};
}

/**
 * Checks the request and resolves the recipient. May throw
 * FixedProviderAdmissionError while looking up a gift name (the caller
 * answers with Retry-After).
 */
export async function readSupportOrderRequest(
  req: ApiRequest,
  store: SupporterStore,
): Promise<SupportOrderRequestResult> {
  const body = requestBody(req);
  const buyer = readSession(req);
  if (!buyer) return { ok: false, status: 401, error: 'Sign in with Twitch to support.' };
  if (body.tier !== undefined && !isSupporterTierId(body.tier)) return { ok: false, status: 400, error: 'Pick a badge tier.' };
  const wantsTier: SupporterTierId | null = isSupporterTierId(body.tier) ? body.tier : null;

  let recipient: SupportRecipient | null = null;
  let kind: SupportOrderKind = 'none';
  if (body.forSelf === true) {
    recipient = { id: buyer.id, login: buyer.login, displayName: buyer.displayName };
    kind = 'self';
  } else {
    const rawLogin = typeof body.login === 'string' ? body.login.trim() : '';
    if (rawLogin) {
      const login = normalizeSupportTwitchLogin(rawLogin);
      if (!login) return { ok: false, status: 400, error: 'That is not a valid Twitch username.' };
      const user = await resolveSupportTwitchUser(login, fixedProviderClientKey(req));
      if (!user) return { ok: false, status: 404, error: 'No Twitch account found.' };
      recipient = { id: user.id, login: user.login, displayName: user.displayName };
      kind = 'gift';
    }
  }

  if (!recipient) {
    if (wantsTier) return { ok: false, status: 400, error: 'Pick who gets the badge.' };
    /* No badge, just support: the buyer's amount. */
    const amountCents = body.amountCents === undefined ? SUPPORT_MIN_CENTS : normalizeSupportAmountCents(body.amountCents);
    if (amountCents === null) return { ok: false, status: 400, error: 'Choose an amount of $5 or more (up to $500).' };
    return { ok: true, order: { amountCents, kind, recipient: null } };
  }

  /* A badge: the tier asked for (Sanctioned from an older page), priced here. */
  const tier = wantsTier ?? 'supporter';
  const standing = await supporterStanding(recipient.id, store);
  const price = standing.prices[tier];
  if (!wantsTier && (price !== null || body.amountCents !== undefined)) {
    /* Any amount (no tier), $5 to $500: charge that, never below what
       Sanctioned still costs; it adds up like any payment, so it names the
       best tier the total reaches. With no amount (an older page), the price. */
    const chosen = body.amountCents === undefined ? price : normalizeSupportAmountCents(body.amountCents);
    if (chosen === null) return { ok: false, status: 400, error: 'Choose an amount of $5 or more (up to $500).' };
    const amountCents = Math.max(chosen, price ?? 0);
    const reached = [...SUPPORTER_TIER_IDS].reverse()
      .find((id) => standing.prices[id] === null || amountCents >= (standing.prices[id] ?? Infinity)) ?? 'supporter';
    return { ok: true, order: { amountCents, kind, recipient, tier: reached } };
  }
  if (price === null) {
    const name = supporterTier(tier).name;
    return {
      ok: false,
      status: 409,
      error: kind === 'self'
        ? `You already have ${name}. Pick a higher tier, or gift one.`
        : `${recipient.displayName} already has ${name}. Pick a higher tier or someone else.`,
    };
  }
  return { ok: true, order: { amountCents: price, kind, recipient, tier } };
}
