import { SUPPORT_BADGE, type SupportTwitchUser } from '@/lib/supportPage';
import {
	SUPPORTER_TIER_IDS,
	isSupporterTierId,
	tierPrices,
	type SupporterTierId,
	type SupporterTierPrices
} from '@/lib/supporterTiers';

export type CheckoutOutcome =
	/* `login`/`displayName` of who got the badge; null when nobody did (a tip).
	   `tier`: the tier that order bought, when the server says. */
	| { kind: 'success'; displayName: string | null; login: string | null; tier?: SupporterTierId | null }
	| { kind: 'pending' }
	| { kind: 'cancelled' }
	| { kind: 'error'; message: string };

/** A Twitch account's FlossChat tier, Founder, and what each tier costs it. */
export type TierStanding = {
	tier: SupporterTierId | null;
	founder: boolean;
	prices: SupporterTierPrices;
};

/** Everything open at full price: nothing paid yet (or not known). */
export const NO_STANDING: TierStanding = { tier: null, founder: false, prices: tierPrices(0) };

/** The `standing` the server sends with /api/auth/me and /api/twitch/support-user. */
export function parseStanding(value: unknown): TierStanding | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as { tier?: unknown; founder?: unknown; prices?: unknown };
	if (record.tier !== null && !isSupporterTierId(record.tier)) return null;
	if (!record.prices || typeof record.prices !== 'object') return null;
	const raw = record.prices as Record<string, unknown>;
	const prices = {} as Record<SupporterTierId, number | null>;
	for (const id of SUPPORTER_TIER_IDS) {
		const price = raw[id];
		if (price !== null && !(Number.isInteger(price) && (price as number) > 0 && (price as number) <= 1_000_000)) return null;
		prices[id] = price as number | null;
	}
	return { tier: record.tier as SupporterTierId | null, founder: record.founder === true, prices };
}

/** The signed-in buyer; `ownsBadge` when they already hold a FlossChat badge,
    `standing` their tier and prices. */
export type SignedInBuyer = SupportTwitchUser & { ownsBadge?: boolean; standing?: TierStanding };

export type SignInState = 'unknown' | { ready: false } | { ready: true; user: SignedInBuyer | null };

/** Only ever leave for PayPal's own approval page. */
export function isPayPalApprovalUrl(candidate: unknown): candidate is string {
	if (typeof candidate !== 'string') return false;
	try {
		const url = new URL(candidate);
		return (
			url.protocol === 'https:' &&
			(url.hostname === 'www.paypal.com' || url.hostname === 'www.sandbox.paypal.com')
		);
	} catch {
		return false;
	}
}

/** Who is signed in with Twitch, from /api/auth/me. */
export async function readMe(): Promise<SignInState> {
	try {
		const response = await fetch('/api/auth/me', { cache: 'no-store' });
		if (!response.ok) return { ready: false };
		const body = (await response.json().catch(() => null)) as {
			user?: Record<string, unknown> | null;
			badges?: unknown;
			standing?: unknown;
		} | null;
		const u = body?.user;
		const standing = parseStanding(body?.standing);
		const ownsBadge =
			Array.isArray(body?.badges) &&
			body.badges.some(
				(badge: unknown) =>
					typeof badge === 'object' &&
					badge !== null &&
					(badge as { id?: unknown }).id === SUPPORT_BADGE.id &&
					(badge as { owned?: unknown }).owned === true
			);
		const user =
			u && typeof u.id === 'string' && typeof u.login === 'string' && typeof u.displayName === 'string'
				? {
						id: u.id,
						login: u.login,
						displayName: u.displayName,
						...(typeof u.avatarUrl === 'string' ? { profileImageUrl: u.avatarUrl } : {}),
						...(ownsBadge ? { ownsBadge: true } : {}),
						...(standing ? { standing } : {})
					}
				: null;
		return { ready: true, user };
	} catch {
		return { ready: false };
	}
}

export type CheckoutStatus = {
	/** Some way to pay is set up on the server (PayPal, Stripe or both). */
	ready: boolean;
	/** For the PayPal buttons: the public client ID. Null: no buttons. */
	paypal: { clientId: string; env: 'sandbox' | 'live' } | null;
	/** PayPal checkout (buttons or redirect) is set up. */
	paypalReady: boolean;
	/** Stripe Checkout (card, Apple Pay, Google Pay) is set up. */
	stripe: boolean;
	/** How many Founder badges are still open; null when not known. */
	founderSlotsLeft?: number | null;
};

const NOT_READY: CheckoutStatus = { ready: false, paypal: null, paypalReady: false, stripe: false };

/**
 * Whether checkout is set up, from /api/support/status (the server side
 * that holds the PayPal keys and the supporter store; never this page).
 */
export async function readCheckoutStatus(): Promise<CheckoutStatus> {
	try {
		const response = await fetch('/api/support/status', { cache: 'no-store' });
		if (!response.ok) return NOT_READY;
		const body = (await response.json().catch(() => null)) as {
			checkoutReady?: unknown;
			paypal?: { clientId?: unknown; env?: unknown } | null;
			stripe?: unknown;
			founderSlotsLeft?: unknown;
		} | null;
		const paypalReady = body?.checkoutReady === true;
		const stripe = body?.stripe === true;
		if (!paypalReady && !stripe) return NOT_READY;
		const slots = body?.founderSlotsLeft;
		const founderSlotsLeft = Number.isInteger(slots) && (slots as number) >= 0 ? (slots as number) : null;
		const clientId = body?.paypal?.clientId;
		const env = body?.paypal?.env;
		return {
			ready: true,
			paypalReady,
			stripe,
			founderSlotsLeft,
			paypal:
				paypalReady &&
				typeof clientId === 'string' &&
				/^[\w-]{10,120}$/.test(clientId) &&
				(env === 'sandbox' || env === 'live')
					? { clientId, env }
					: null
		};
	} catch {
		return NOT_READY;
	}
}

/**
 * Whether this Twitch id already shows the FlossChat badge, from the public
 * badge list overlays use (/api/twitch/gxufy-badges). Someone who took their
 * badge off is not in it, so they read as "not yet". Null when unknown.
 */
export async function recipientHasBadge(twitchId: string): Promise<boolean | null> {
	try {
		const response = await fetch('/api/twitch/gxufy-badges');
		if (!response.ok) return null;
		const list = (await response.json().catch(() => null)) as unknown;
		if (!Array.isArray(list)) return null;
		const badge = list.find(
			(entry: unknown) =>
				typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === SUPPORT_BADGE.id
		) as { userIds?: unknown } | undefined;
		return Array.isArray(badge?.userIds) ? badge.userIds.includes(twitchId) : false;
	} catch {
		return null;
	}
}

/** The amount as characters keyed by place from the right ("12" -> "2:1",
    "1:2"), so a digit that changes is a new element and can roll in. */
export function amountPlaces(text: string): { key: string; char: string }[] {
	const chars = [...(text || '0')];
	return chars.map((char, index) => ({ key: `${chars.length - index}:${char}`, char }));
}

/** Only ever leave for Stripe's own hosted checkout. */
export function isStripeCheckoutUrl(candidate: unknown): candidate is string {
	if (typeof candidate !== 'string') return false;
	try {
		const url = new URL(candidate);
		return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
	} catch {
		return false;
	}
}

export const STRIPE_SESSION_ID_RE = /^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/;
