<script lang="ts">
	/*
	 * The support checkout, laid out like Chatlee's supporter page: the Founder
	 * card (first FOUNDER_LIMIT, how many are claimed), a fanned stack of the tier badges (the
	 * picked one in front), the price, the tier pills, who gets it, and PayPal
	 * or a card. Payments add up: the price shown is what is left to reach that
	 * tier for that account (the server's own numbers). A sliding For you / As
	 * a gift switch, springy presses, the recipient's real Twitch picture, a
	 * check on tiers already reached, and links to the terms. "Custom" takes any
	 * amount from $5 to $500 instead: it gets the best badge the new total
	 * reaches and counts toward the next one. All motion is off under
	 * prefers-reduced-motion.
	 *
	 * The server sets and checks every amount; the badge is granted only after
	 * PayPal or Stripe reports a completed payment of exactly that amount.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import { cssText } from '#lib/site/cssText.ts';
	import { HOME_ORIGIN } from '@/lib/domains.mjs';
	import {
		SUPPORT_BADGE,
		SUPPORT_MAX_CENTS,
		SUPPORT_MIN_CENTS,
		SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS,
		cleanSupportAmountInput,
		clampSupportAmountCents,
		formatSupportAmount,
		normalizeSupportAmountCents,
		normalizeSupportTwitchLogin,
		parseSupportAmount,
		parseSupportTwitchUser,
		type SupportTwitchUser
	} from '@/lib/supportPage';
	import { acquirePreviewIdentity, cachedPreviewIdentity } from '@/features/multichat/previewIdentityClient';
	import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
	import { loadPreviewBttvProBadges } from '@/features/multichat/previewBttvPro';
	import { resolveTwitchJilChatBadges } from '@/lib/communityBadges';
	import { buildSupportBadgePreview, buildSupportUsernameStyle } from '@/lib/supportPreview';
	import {
		FOUNDER_LIMIT,
		MIN_TIER_STEP_CENTS,
		SUPPORTER_TIERS,
		isSupporterTierId,
		supporterTier,
		type SupporterTierId,
		type SupporterTierPrices
	} from '@/lib/supporterTiers';
	import { signInNote } from '@/lib/badgesPage';
	import type { UnifiedBadge } from '@/lib/types';
	import {
		NO_STANDING,
		STRIPE_SESSION_ID_RE,
		isPayPalApprovalUrl,
		isStripeCheckoutUrl,
		parseStanding,
		readCheckoutStatus,
		readMe,
		type CheckoutOutcome,
		type CheckoutStatus,
		type SignInState,
		type TierStanding
	} from './checkout.ts';
	import PayPalButtons from './PayPalButtons.svelte';
	import { fitChatLine } from './fitChatLine.ts';
	import type { PayPalFundingSource } from './paypalSdk.ts';
	import { SUPPORT_CONTACT_EMAIL, SUPPORT_TERMS_PATH } from './supportInfo.ts';

	type AccountState = 'idle' | 'waiting' | 'checking' | 'found' | 'error' | 'unavailable';
	type BadgeLoadState = 'idle' | 'loading' | 'loaded';
	/** The badge tier on show, or 'custom': any amount, the best tier it reaches. */
	type Choice = SupporterTierId | 'custom';

	/* Each tier's big art (the owner's hand, in its tier version). */
	const TIER_ART: Record<SupporterTierId, string> = {
		supporter: '/badges/gxufy/supporter-hand.webp',
		suvy: '/badges/gxufy/suvy-hand.webp',
		'top-suvy': '/badges/gxufy/top-suvy-hand.webp'
	};
	const FOUNDER_ART = '/badges/gxufy/founder-hand.webp';
	/* One line under each tier's name in the showcase. */
	const TIER_BLURB: Record<SupporterTierId, string> = {
		supporter: 'The original FlossChat supporter badge, beside your name in every chat.',
		suvy: 'The rose lights up from inside. Beside your name in every chat, for good.',
		'top-suvy': 'A galaxy in the ink, with a heartbeat. For the biggest supporters.'
	};

	let {
		status,
		variant = 'page'
	}: {
		/** Whether checkout is set up, and PayPal's public client ID for the
		    buttons. Left out: asked from /api/support/status when the page opens. */
		status?: CheckoutStatus;
		/** 'modal' when shown over the generator instead of on /support. */
		variant?: 'page' | 'modal';
	} = $props();

	let checkoutBusy = $state(false);
	let outcome = $state.raw<CheckoutOutcome | null>(null);
	/* For the thank-you: whether the order was a custom amount, and the tier
	   its recipient held before it (set when the order is made). */
	let orderCustom = false;
	let orderHeldTier: SupporterTierId | null = null;
	let twitchInput = $state('');
	let accountState = $state<AccountState>('idle');
	let accountMessage = $state('');
	let account = $state.raw<SupportTwitchUser | null>(null);
	let submissionNote = $state('');
	let badgeIdentity = $state.raw<PreviewIdentityResponse | null>(null);
	let deferredCommunityBadges = $state.raw<readonly UnifiedBadge[]>([]);
	let bttvProBadgeUrl = $state<string | null>(null);
	let badgeLoadState = $state<BadgeLoadState>('idle');
	/* Twitch sign-in: 'unknown' until /api/auth/me answers; user null = signed
	   out; ready false = sign-in not set up (the sign-in parts are hidden). */
	let signIn = $state.raw<SignInState>('unknown');
	/* Back from Twitch with ?signin=failed or ?signin=cancelled. */
	let signInMessage = $state('');
	let signInFailed = $state(false);
	let recipientMode = $state<'self' | 'gift'>('self');
	let choice = $state<Choice>('supporter');
	/* Once the visitor picks a tier themselves, the page stops picking for them. */
	let pickedTier = false;
	const TIER_IDS: readonly SupporterTierId[] = SUPPORTER_TIERS.map((tier) => tier.id);
	const CHOICES: readonly Choice[] = [...TIER_IDS, 'custom'];
	/* Custom: what's in the amount box (dollars, no $), kept while the visitor
	   switches between choices. */
	let customText = $state('15');
	/* The gift recipient's tier and prices, from the Twitch name check. */
	let recipientStanding = $state.raw<TierStanding | null>(null);

	let statusRequest: Promise<CheckoutStatus> | null = null;
	/* What /api/support/status said, once it has answered. */
	let knownStatus = $state.raw<CheckoutStatus | null>(null);
	/* The PayPal script couldn't load (ad blocker, offline): use the redirect. */
	let paypalBlocked = $state(false);

	function checkoutStatus(): Promise<CheckoutStatus> {
		if (status) return Promise.resolve(status);
		statusRequest ??= readCheckoutStatus().then((answer) => (knownStatus = answer));
		return statusRequest;
	}

	async function isCheckoutReady(): Promise<boolean> {
		return (await checkoutStatus()).ready;
	}

	const currentStatus = $derived(status ?? knownStatus);
	const paypalClientId = $derived(currentStatus?.paypal?.clientId ?? null);
	const showPayPalButtons = $derived(paypalClientId !== null && !paypalBlocked);
	const stripeReady = $derived(currentStatus?.stripe === true);
	/* The redirect to PayPal: when its buttons can't show (or until the
	   status is known), and never when only Stripe is set up. */
	const showContinue = $derived(!showPayPalButtons && !(stripeReady && currentStatus?.paypalReady === false));

	onMount(() => {
		let cancelled = false;
		void checkoutStatus();
		void readMe().then((state) => {
			if (!cancelled) signIn = state;
		});
		return () => {
			cancelled = true;
		};
	});

	const signedInUser = $derived(signIn !== 'unknown' && signIn.ready ? signIn.user : null);

	/* Back to where sign-in started: the /support page, or the generator with
	   this popup reopened. */
	const signInHref = $derived(
		`/api/auth/twitch/login?next=${encodeURIComponent(
			variant === 'modal' && typeof window !== 'undefined'
				? `${window.location.pathname}?support=1`
				: '/support'
		)}`
	);

	/* Payments add up: someone with a tier can move up, for themselves or as a gift. */
	const forSelf = $derived(signedInUser !== null && recipientMode === 'self');
	const founderSlotsLeft = $derived(currentStatus?.founderSlotsLeft ?? null);

	/* "For you": the preview follows the signed-in account. */
	$effect(() => {
		if (forSelf && signedInUser) twitchInput = signedInUser.login;
	});

	const normalizedLogin = $derived(normalizeSupportTwitchLogin(twitchInput));

	const hasPreview = $derived(
		accountState === 'found' && account !== null && account.login === normalizedLogin
	);
	/* Whoever gets the badge: the signed-in account or a verified gift name. */
	const knownRecipient = $derived(forSelf || hasPreview);
	/* Their tier and prices (the server charges the same). Before anyone is
	   chosen, every tier shows its full price. */
	const standing = $derived(
		forSelf ? (signedInUser?.standing ?? NO_STANDING) : hasPreview ? (recipientStanding ?? NO_STANDING) : NO_STANDING
	);
	const isCustom = $derived(choice === 'custom');
	/* Custom: the typed amount in cents (null while it isn't $5–$500). */
	const customCents = $derived(normalizeSupportAmountCents(parseSupportAmount(customText.replace(/\.$/, ''))));
	/* The tier on show: the one picked, or the best one the custom amount
	   reaches from what they already have (the server works it out the same). */
	const shownTier = $derived<SupporterTierId>(
		choice === 'custom' ? reachedTier(standing.prices, customCents ?? SUPPORT_MIN_CENTS) : choice
	);
	const tierPrice = $derived(choice === 'custom' ? null : standing.prices[choice]);
	/* That tier (or a higher one) is already theirs. */
	const tierReached = $derived(!isCustom && knownRecipient && tierPrice === null);
	const payCents = $derived(
		choice === 'custom'
			? (parseSupportAmount(customText.replace(/\.$/, '')) ?? SUPPORT_MIN_CENTS)
			: (tierPrice ?? supporterTier(choice).priceCents)
	);
	const payLabel = $derived(formatSupportAmount(payCents));
	/* A badge needs who gets it, and a tier they don't have yet (or, custom,
	   an amount from $5 to $500). */
	const ready = $derived(knownRecipient && (isCustom ? customCents !== null : tierPrice !== null));
	/* The Founder card: how many of the Founder badges are taken. */
	const founderTaken = $derived(founderSlotsLeft === null ? 0 : Math.max(0, FOUNDER_LIMIT - founderSlotsLeft));

	function pick(next: Choice) {
		pickedTier = true;
		choice = next;
	}

	/* The best tier `cents` reaches, from the step prices (null = already held). */
	function reachedTier(prices: SupporterTierPrices, cents: number): SupporterTierId {
		for (const id of [...TIER_IDS].reverse()) {
			const price = prices[id];
			if (price === null || cents >= price) return id;
		}
		return TIER_IDS[0];
	}

	/* The tier after this one, or null at the top. */
	function nextTier(id: SupporterTierId): SupporterTierId | null {
		return TIER_IDS[TIER_IDS.indexOf(id) + 1] ?? null;
	}

	/* The amount box: digits and one dot as you type; anything outside
	   $5–$500 is pulled back in when you leave it. */
	function typeAmount(event: Event & { currentTarget: HTMLInputElement }) {
		const cleaned = cleanSupportAmountInput(event.currentTarget.value);
		if (cleaned !== event.currentTarget.value) event.currentTarget.value = cleaned;
		customText = cleaned;
	}

	function snapAmount() {
		const typed = parseSupportAmount(customText.replace(/\.$/, ''));
		customText = formatSupportAmount(clampSupportAmountCents(typed ?? SUPPORT_MIN_CENTS)).slice(1);
	}

	function stepAmount(dollars: number) {
		const typed = parseSupportAmount(customText.replace(/\.$/, '')) ?? SUPPORT_MIN_CENTS;
		customText = formatSupportAmount(clampSupportAmountCents(typed + dollars * 100)).slice(1);
	}

	function amountKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			snapAmount();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			stepAmount((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
		}
	}

	async function pickCustom() {
		pick('custom');
		await tick();
		document.getElementById('support-amount')?.focus();
	}

	/* Arrow keys move between the tiers, like any radio group. */
	function tierKey(event: KeyboardEvent) {
		const step =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (!step) return;
		event.preventDefault();
		const next = CHOICES[(CHOICES.indexOf(choice) + step + CHOICES.length) % CHOICES.length];
		pick(next);
		(event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
	}

	/* Someone who already holds the tier on show starts on the next one up. */
	$effect(() => {
		if (pickedTier || choice === 'custom' || !knownRecipient || standing.prices[choice] !== null) return;
		const next = SUPPORTER_TIERS.find((tier) => standing.prices[tier.id] !== null);
		if (next) choice = next.id;
	});

	const recipientHasIt = $derived.by(() => {
		if (!tierReached || !standing.tier) return '';
		const has = supporterTier(standing.tier).name;
		const they = account ? `${account.displayName} already has` : 'They already have';
		if (standing.tier === 'top-suvy') {
			return forSelf
				? 'You have Top Suvy, the highest tier. You can gift one to someone else.'
				: `${they} Top Suvy, the highest tier. Pick someone else.`;
		}
		return forSelf
			? `You already have ${has}. Pick a higher tier, or gift one.`
			: `${they} ${has}. Pick a higher tier or someone else.`;
	});
	const tierNote = $derived.by(() => {
		if (choice === 'custom') return customNote;
		if (tierReached) return 'Already theirs.';
		const full = supporterTier(choice).priceCents;
		if (knownRecipient && tierPrice !== null && tierPrice < full) {
			return `Your earlier payments count (instead of ${formatSupportAmount(full)}).`;
		}
		return 'Pay once, keep it for good.';
	});
	/* Custom: what the amount gets, and what is left to the next tier after it. */
	const customNote = $derived.by(() => {
		if (customCents === null) return `Pick ${formatSupportAmount(SUPPORT_MIN_CENTS)} to ${formatSupportAmount(SUPPORT_MAX_CENTS)}.`;
		const name = supporterTier(shownTier).name;
		const next = nextTier(shownTier);
		const nextPrice = next ? standing.prices[next] : null;
		const after = next && nextPrice !== null
			? ` ${formatSupportAmount(Math.max(MIN_TIER_STEP_CENTS, nextPrice - customCents))} more later reaches ${supporterTier(next).name}.`
			: '';
		if (!knownRecipient) return `Gets the best badge it reaches: ${name}.${after}`;
		if (standing.prices[shownTier] === null) {
			return next
				? `${forSelf ? 'You have' : 'They have'} ${name}; this counts toward ${supporterTier(next).name}.${after}`
				: `${forSelf ? 'You have' : 'They have'} Top Suvy. Thank you for the extra support.`;
		}
		return `Gets ${forSelf ? 'you' : 'them'} ${name}.${after}`;
	});
	const emblem = $derived({
		url: TIER_ART[shownTier],
		name: supporterTier(shownTier).name,
		title: `FlossChat ${supporterTier(shownTier).name}`
	});
	/* The showcase stack: the picked badge in front, the others fanned behind
	   it (the one before on the left, the one after on the right). */
	const stack = $derived(
		TIER_IDS.map((id, index) => {
			const offset = (index - TIER_IDS.indexOf(shownTier) + TIER_IDS.length) % TIER_IDS.length;
			return { id, place: offset === 0 ? 'front' : offset === 1 ? 'right' : 'left' };
		})
	);
	const supportUsernameStyle = $derived(cssText(buildSupportUsernameStyle(badgeIdentity)));
	const supportBadges = $derived(
		buildSupportBadgePreview(
			badgeIdentity,
			deferredCommunityBadges,
			bttvProBadgeUrl,
			true,
			{ id: shownTier, title: emblem.title, url: emblem.url }
		)
	);

	/* What the preview line shows, so it is fitted again when that changes. */
	const chatLineContents = $derived(
		`${supportBadges.map((badge) => badge.key).join(' ')}|${hasPreview ? (account?.displayName ?? '') : ''}`
	);

	/* Who gets the badge: checked against Twitch as you type (debounced). */
	$effect(() => {
		const raw = twitchInput.trim();
		const login = normalizedLogin;
		submissionNote = '';
		recipientStanding = null;
		if (!raw) {
			account = null;
			accountState = 'idle';
			accountMessage = '';
			return;
		}
		if (!login) {
			account = null;
			accountState = 'error';
			accountMessage =
				raw.replace(/^@+/, '').length < 3
					? 'Use at least 3 characters.'
					: 'Use 3 to 25 letters, numbers, or underscores.';
			return;
		}
		const controller = new AbortController();
		account = null;
		accountState = 'waiting';
		accountMessage = 'Checking Twitch…';
		const timer = window.setTimeout(async () => {
			accountState = 'checking';
			try {
				const response = await fetch(`/api/twitch/support-user?login=${encodeURIComponent(login)}`, {
					cache: 'no-store',
					signal: controller.signal
				});
				const body = await response.json().catch(() => null);
				if (controller.signal.aborted) return;
				if (response.status === 404) {
					accountState = 'error';
					accountMessage = 'No Twitch account found.';
					return;
				}
				if (!response.ok) {
					accountState = 'unavailable';
					accountMessage = 'Twitch verification is temporarily unavailable.';
					return;
				}
				const parsed = parseSupportTwitchUser(body, login);
				if (!parsed) {
					accountState = 'unavailable';
					accountMessage = 'Twitch verification returned an invalid response.';
					return;
				}
				account = parsed;
				recipientStanding = parseStanding((body as { standing?: unknown } | null)?.standing);
				accountState = 'found';
				accountMessage = `Verified as ${parsed.displayName}.`;
			} catch (error) {
				if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
				accountState = 'unavailable';
				accountMessage = 'Twitch verification is temporarily unavailable.';
			}
		}, SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	});

	/* The verified account's real chat look: badges from every provider and
	   its 7TV paint. Cosmetics failing never undoes the verification. */
	$effect(() => {
		const verified = hasPreview ? account : null;
		let cancelled = false;
		deferredCommunityBadges = [];
		bttvProBadgeUrl = null;
		if (!verified) {
			badgeIdentity = null;
			badgeLoadState = 'idle';
			return;
		}
		badgeLoadState = 'loading';
		/* The session cache paints badges at once when this account was already
		   looked up in this browser session. */
		const cached = cachedPreviewIdentity(verified.login);
		badgeIdentity = cached && cached.identity.userId === verified.id ? cached : null;

		const acquired = acquirePreviewIdentity(verified.login);
		const acceptIdentity = (response: PreviewIdentityResponse) => {
			if (cancelled || response.identity.userId !== verified.id || response.identity.login !== verified.login) {
				return;
			}
			badgeIdentity = response;
		};
		/* Base Twitch/FFZ/BTTV/7TV resources first. */
		void acquired.promise
			.then(acceptIdentity)
			.catch(() => {})
			.finally(() => acquired.release());
		/* Community providers enrich the same response in the background. */
		void acquired.enrichment.then(acceptIdentity).catch(() => {});
		/* JilChat is deferred from the preview's fast path on purpose. */
		const jilChat = resolveTwitchJilChatBadges(verified.id)
			.then((badges) => {
				if (!cancelled) deferredCommunityBadges = badges;
			})
			.catch(() => {});
		/* BTTV Pro: the existing one-user websocket lookup. */
		const bttvPro = loadPreviewBttvProBadges([{ userId: verified.id }])
			.then((badges) => {
				if (!cancelled) bttvProBadgeUrl = badges.get(verified.id) ?? null;
			})
			.catch(() => {});
		void Promise.allSettled([acquired.enrichment, jilChat, bttvPro]).then(() => {
			if (!cancelled) badgeLoadState = 'loaded';
		});
		return () => {
			cancelled = true;
			acquired.release();
		};
	});

	let mounted = true;
	onDestroy(() => {
		mounted = false;
	});

	/* Ask our server to capture and check the payment (never trust the
	   browser): used after PayPal's window and after the redirect back. */
	async function confirmPayment(orderId: string) {
		return confirmWith('/api/support/capture', { orderId });
	}

	async function confirmWith(url: string, payload: Record<string, string>) {
		checkoutBusy = true;
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				cache: 'no-store'
			});
			const body = (await response.json().catch(() => null)) as {
				status?: string;
				recipient?: { displayName?: string; login?: string } | null;
				tier?: unknown;
			} | null;
			if (!mounted) return;
			if (response.ok && body?.status === 'completed') {
				outcome = {
					kind: 'success',
					displayName: body.recipient?.displayName ?? null,
					login: body.recipient?.login ?? null,
					tier: isSupporterTierId(body.tier) ? body.tier : null
				};
				/* Their new tier: the next prices start from it. */
				void readMe().then((state) => {
					if (mounted) signIn = state;
				});
			} else if (response.status === 202) {
				outcome = { kind: 'pending' };
			} else {
				outcome = {
					kind: 'error',
					message:
						'We could not confirm that payment. You have not been charged twice; if money left your account, contact us.'
				};
			}
		} catch {
			if (mounted) {
				outcome = {
					kind: 'error',
					message: 'We could not confirm the payment. If money left your account, contact us and we will sort it out.'
				};
			}
		} finally {
			if (mounted) checkoutBusy = false;
		}
	}

	/* Who the thank-you is for: the buyer's own badge, a gift, or a tip with no badge. */
	const thanksFor = $derived.by((): 'self' | 'gift' | 'none' => {
		if (outcome?.kind !== 'success' || !outcome.displayName) return 'none';
		return signedInUser && outcome.login === signedInUser.login ? 'self' : 'gift';
	});
	/* The tier that payment bought (from the server), for the thank-you. */
	const thanksTier = $derived(outcome?.kind === 'success' && outcome.tier ? outcome.tier : null);
	/* A custom amount that reached no new tier: it adds up toward the next one. */
	const thanksAddsUp = $derived(
		outcome?.kind === 'success' && orderCustom && thanksTier !== null && thanksTier === orderHeldTier
	);
	const thanksNext = $derived(thanksTier ? nextTier(thanksTier) : null);

	/* Back to the form for another gift: same amount, empty name. */
	async function giftAnother() {
		outcome = null;
		submissionNote = '';
		recipientMode = 'gift';
		twitchInput = '';
		await tick();
		document.getElementById('support-twitch')?.focus();
	}

	/* Back from Twitch's sign-in, or from PayPal's or Stripe's page. */
	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const signin = params.get('signin');
		if (signin) {
			signInMessage = signInNote(signin);
			signInFailed = signin === 'failed';
			params.delete('signin');
			const rest = params.toString();
			window.history.replaceState(
				window.history.state,
				'',
				`${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
			);
		}
		const paypal = params.get('paypal');
		const stripe = params.get('stripe');
		if (!paypal && !stripe) return;
		window.history.replaceState(window.history.state, '', window.location.pathname);
		if (paypal === 'cancel' || stripe === 'cancel') {
			outcome = { kind: 'cancelled' };
			return;
		}
		const orderId = params.get('token') ?? '';
		if (paypal === 'return' && /^[A-Z0-9]{10,40}$/.test(orderId)) {
			void confirmPayment(orderId);
			return;
		}
		const sessionId = params.get('session_id') ?? '';
		if (stripe === 'return' && STRIPE_SESSION_ID_RE.test(sessionId)) {
			void confirmWith('/api/support/stripe-confirm', { sessionId });
		}
	});

	/* Card, Apple Pay or Google Pay: on to Stripe's checkout page. */
	let stripeBusy = $state(false);
	async function payWithStripe() {
		if (!ready || checkoutBusy || stripeBusy) return;
		submissionNote = '';
		outcome = null;
		stripeBusy = true;
		try {
			const response = await fetch('/api/support/stripe-checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(orderRequest()),
				cache: 'no-store'
			});
			const body = (await response.json().catch(() => null)) as {
				url?: unknown;
				error?: unknown;
				detail?: unknown;
			} | null;
			if (response.ok && isStripeCheckoutUrl(body?.url)) {
				window.location.assign(body.url);
				return;
			}
			submissionNote = typeof body?.error === 'string' ? body.error : 'Card checkout is not available right now.';
			/* Only the dev server sends `detail` (Stripe's reason, keys masked). */
			if (typeof body?.detail === 'string' && body.detail) submissionNote += ` (${body.detail})`;
		} catch {
			submissionNote = 'Card checkout is not available right now.';
		}
		stripeBusy = false;
	}

	/* What the server needs to create an order for what's on the page. */
	function orderRequest(fundingSource?: PayPalFundingSource) {
		orderCustom = choice === 'custom';
		orderHeldTier = standing.tier;
		return {
			/* The tier (the server prices it), or a custom amount (the server
			   works out the tier it reaches), and who gets it. */
			...(choice === 'custom' ? { amountCents: customCents } : { tier: choice }),
			...(forSelf ? { forSelf: true } : { login: hasPreview ? (account?.login ?? '') : '' }),
			...(fundingSource ? { fundingSource } : {})
		};
	}

	/* A PayPal button was pressed: create the order on our server. */
	async function createButtonOrder(fundingSource: PayPalFundingSource): Promise<string> {
		submissionNote = '';
		outcome = null;
		const failed = (message: string) => {
			submissionNote = message;
			return new Error(message);
		};
		let response: Response;
		try {
			response = await fetch('/api/support/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(orderRequest(fundingSource)),
				cache: 'no-store'
			});
		} catch {
			throw failed('Checkout is not available right now.');
		}
		const body = (await response.json().catch(() => null)) as { orderId?: unknown; error?: unknown } | null;
		if (response.ok && typeof body?.orderId === 'string' && /^[A-Z0-9]{10,40}$/.test(body.orderId)) {
			return body.orderId;
		}
		throw failed(typeof body?.error === 'string' ? body.error : 'Checkout is not available right now.');
	}

	function paymentFailed() {
		if (!submissionNote) outcome = { kind: 'error', message: 'PayPal ran into a problem. Nothing was charged.' };
	}

	function payPalUnavailable() {
		paypalBlocked = true;
		submissionNote = 'PayPal’s buttons couldn’t load. Reload, or pause your ad blocker. You can still continue to PayPal below.';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!ready || checkoutBusy) return;
		/* With PayPal's buttons (or only Stripe) on the page, paying starts
		   from one of the buttons. */
		if (!showContinue) return;
		if (!(await isCheckoutReady())) {
			submissionNote = hasPreview
				? `Checkout is not connected yet. ${account?.displayName} is verified as the future badge recipient.`
				: 'Checkout is not connected yet. This private preview cannot charge you.';
			return;
		}
		submissionNote = '';
		outcome = null;
		checkoutBusy = true;
		try {
			const response = await fetch('/api/support/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(orderRequest()),
				cache: 'no-store'
			});
			const body = (await response.json().catch(() => null)) as { approveUrl?: unknown; error?: unknown } | null;
			if (response.ok && isPayPalApprovalUrl(body?.approveUrl)) {
				window.location.assign(body.approveUrl);
				return;
			}
			submissionNote = typeof body?.error === 'string' ? body.error : 'Checkout is not available right now.';
		} catch {
			submissionNote = 'Checkout is not available right now.';
		}
		checkoutBusy = false;
	}
</script>
<div class="sp{variant === 'modal' ? ' is-modal' : ''}">
	<div class="sp-shell">
		{#if variant === 'page'}
			<a class="sp-back" href={HOME_ORIGIN} aria-label="Back to Gxufy">
				<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M15 18l-6-6 6-6" />
				</svg>
			</a>
		{/if}

		<header class="sp-heading">
			<h1>Support <em>Floss</em>Chat</h1>
			<p>Help keep FlossChat frequently updated as platform APIs change. Ongoing development takes time.</p>
			<a class="sp-mine" href="/badges">
				Your badges
				<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
			</a>
		</header>

		{#if founderSlotsLeft !== null}
			<section class="sp-card sp-first" aria-labelledby="sp-first-title">
				<img class="sp-first-badge" src={FOUNDER_ART} alt="FlossChat Founder badge" />
				<div class="sp-first-text">
					<span class="sp-first-kicker">Founder</span>
					<h2 id="sp-first-title">The first {FOUNDER_LIMIT} supporters</h2>
					<p>
						{founderSlotsLeft > 0
							? `Get any badge now and the Founder badge comes with it. Once all ${FOUNDER_LIMIT} are taken, it’s gone.`
							: `All ${FOUNDER_LIMIT} Founder badges have been taken. Thank you.`}
					</p>
				</div>
				<div class="sp-first-count">
					<strong>{founderTaken}<span> / {FOUNDER_LIMIT}</span></strong>
					<span class="sp-first-left">claimed</span>
					<span
						class="sp-first-bar"
						role="progressbar"
						aria-label="Founder badges taken"
						aria-valuemin={0}
						aria-valuemax={FOUNDER_LIMIT}
						aria-valuenow={founderTaken}
					><span style="width: {(founderTaken / FOUNDER_LIMIT) * 100}%"></span></span>
				</div>
			</section>
		{/if}

		<div class="sp-grid">
			<aside class="sp-showcase" aria-label="Chat badge preview">
				<div class="sp-stack" role="group" aria-label="Badges (pick one to preview it)">
					{#each stack as card (card.id)}
						<button
							type="button"
							class="sp-stack-card is-{card.place}"
							aria-label="{supporterTier(card.id).name} badge"
							aria-pressed={card.place === 'front'}
							tabindex={card.place === 'front' ? -1 : 0}
							onclick={() => pick(card.id)}
						>
							<img src={TIER_ART[card.id]} alt="" />
						</button>
					{/each}
				</div>
				<h2><span>{emblem.name}</span> badge</h2>
				<p class="sp-reward">{TIER_BLURB[shownTier]}</p>
				<p class="sp-stack-hint">Tap a badge to preview it.</p>

				<div class="sp-chat" aria-label="Username preview">
					<div class="sp-chat-row" use:fitChatLine={chatLineContents}>
						{#each supportBadges as badge (badge.key)}
							<img
								class={badge.url === emblem.url ? 'sp-chat-badge is-feature' : 'sp-chat-badge'}
								src={badge.url}
								alt={badge.title}
								title={badge.title}
							/>
						{/each}
						<span class="sp-chat-line"><strong class="sp-chat-name" style={supportUsernameStyle}>{hasPreview ? account?.displayName : 'YourNameHere'}</strong><span class="sp-chat-text">: hey chat</span></span>
					</div>
				</div>
				<p class="sp-chat-status" aria-live="polite">
					{badgeLoadState === 'loading' ? 'Loading linked Twitch badges…' : ''}
				</p>
			</aside>

			{#if outcome?.kind === 'success'}
				<section class="sp-card sp-checkout sp-thanks">
					<img src={thanksTier ? TIER_ART[thanksTier] : SUPPORT_BADGE.url} alt="" class="sp-thanks-badge" />
					<div role="status">
						<h2>Thank you!</h2>
						<p>
							{#if thanksAddsUp && thanksFor !== 'none'}
								Thank you for the extra support!{thanksNext
									? ` It counts toward ${thanksFor === 'self' ? 'your' : `${outcome.displayName}’s`} ${supporterTier(thanksNext).name} badge.`
									: ''}
							{:else if thanksFor === 'self'}
								Your {thanksTier ? supporterTier(thanksTier).name : 'FlossChat'} badge is on. It shows up next to your name in chat within seconds.
							{:else if thanksFor === 'gift'}
								<strong>{outcome.displayName}</strong> now has the {thanksTier ? supporterTier(thanksTier).name : 'FlossChat'} badge. It shows up in chat within seconds.
							{:else}
								Your support means a lot.
							{/if}
						</p>
					</div>
					<div class="sp-thanks-actions">
						{#if thanksFor === 'self'}
							<a class="sp-continue" href="/badges">See your badge</a>
						{:else if thanksFor === 'gift'}
							<button class="sp-continue" type="button" onclick={giftAnother}>Gift another</button>
						{/if}
						{#if variant === 'page'}
							<a class="sp-continue is-quiet" href="/">Back to FlossChat</a>
						{/if}
					</div>
				</section>
			{:else}
				<form class="sp-card sp-checkout" onsubmit={submit} novalidate>
					<fieldset>
						<legend class="sr-only">Badge tier and price</legend>

						{#if choice === 'custom'}
							<!-- Custom: type any amount from $5 to $500, or step it a dollar at a time
							     (the − / + keep the focus in the box while you step). -->
							<div class="sp-price is-custom">
								<button
									type="button"
									class="sp-step"
									aria-label="$1 less"
									disabled={(customCents ?? SUPPORT_MIN_CENTS) <= SUPPORT_MIN_CENTS}
									onpointerdown={(event) => event.preventDefault()}
									onclick={() => stepAmount(-1)}
								>
									<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8h9" /></svg>
								</button>
								<span class="sp-currency-symbol" aria-hidden="true">$</span>
								<label class="sp-amount">
									<span class="sr-only">Amount in US dollars, $5 to $500</span>
									<span class="sp-amount-sizer" aria-hidden="true">{customText || '0'}</span>
									<input
										id="support-amount"
										class="sp-amount-input"
										inputmode="decimal"
										autocomplete="off"
										size="1"
										maxlength="8"
										value={customText}
										aria-describedby="support-amount-note"
										oninput={typeAmount}
										onblur={snapAmount}
										onkeydown={amountKey}
									/>
								</label>
								<span class="sp-currency" aria-hidden="true">USD</span>
								<button
									type="button"
									class="sp-step"
									aria-label="$1 more"
									disabled={(customCents ?? SUPPORT_MIN_CENTS) >= SUPPORT_MAX_CENTS}
									onpointerdown={(event) => event.preventDefault()}
									onclick={() => stepAmount(1)}
								>
									<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8h9M8 3.5v9" /></svg>
								</button>
							</div>
						{:else}
							<!-- A badge's price is set by the server: what is left to reach that tier. -->
							<div class="sp-price is-fixed">
								<span class="sp-currency-symbol" aria-hidden="true">$</span>
								<span class="sp-amount" role="img" aria-label="{payLabel} US dollars">
									<span class="sp-amount-sizer" aria-hidden="true">{payLabel.slice(1)}</span>
									<span class="sp-amount-digits" aria-hidden="true">{#key payLabel}<span class="sp-digit is-up">{payLabel.slice(1)}</span>{/key}</span>
								</span>
								<span class="sp-currency" aria-hidden="true">USD</span>
							</div>
						{/if}
						<p
							id="support-amount-note"
							class="sp-hint{choice !== 'custom' && knownRecipient && !tierReached && tierPrice !== null && tierPrice < supporterTier(choice).priceCents ? ' is-credit' : ''}{choice === 'custom' && customCents === null ? ' is-limit' : ''}"
							aria-live="polite"
						>{tierNote}</p>

						<div class="sp-tiers" role="radiogroup" aria-label="Badge" tabindex="-1" onkeydown={tierKey}>
							{#each SUPPORTER_TIERS as tier (tier.id)}
								{@const have = knownRecipient && standing.prices[tier.id] === null}
								<button
									type="button"
									role="radio"
									class="sp-tier{have ? ' is-have' : ''}"
									data-choice={tier.id}
									aria-checked={choice === tier.id}
									tabindex={choice === tier.id ? 0 : -1}
									onclick={() => pick(tier.id)}
								>
									<span class="sp-tier-name">{#if have}<svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>{/if}{tier.name}</span>
									<span class="sp-tier-price">{have ? 'Have it' : formatSupportAmount(tier.priceCents)}</span>
								</button>
							{/each}
							<button
								type="button"
								role="radio"
								class="sp-tier is-custom"
								data-choice="custom"
								aria-checked={choice === 'custom'}
								tabindex={choice === 'custom' ? 0 : -1}
								onclick={() => void pickCustom()}
							>
								<span class="sp-tier-name">Custom</span>
								<span class="sp-tier-price">{formatSupportAmount(SUPPORT_MIN_CENTS)}+</span>
							</button>
						</div>

						<!-- Nobody supports without signing in with Twitch first, so
						     every payment is tied to a known account. -->
						{#if signedInUser}
							<div class="sp-switch" role="radiogroup" aria-label="Who gets the badge" data-on={recipientMode}>
								<span class="sp-switch-pill" aria-hidden="true"></span>
								<button
									type="button"
									role="radio"
									aria-checked={recipientMode === 'self'}
									onclick={() => (recipientMode = 'self')}
								>
									<svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="5.2" r="2.7" /><path d="M2.8 13.6c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4" /></svg>
									For you
								</button>
								<button
									type="button"
									role="radio"
									aria-checked={recipientMode === 'gift'}
									onclick={() => {
										recipientMode = 'gift';
										twitchInput = '';
									}}
								>
									<svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15"><rect x="2.5" y="6" width="11" height="7.5" rx="1.2" /><path d="M2 6h12M8 6v7.5M8 6C6.6 6 4.6 5.6 4.6 4.1c0-.9.7-1.5 1.5-1.5C7.5 2.6 8 4.6 8 6Zm0 0c1.4 0 3.4-.4 3.4-1.9 0-.9-.7-1.5-1.5-1.5C8.5 2.6 8 4.6 8 6Z" /></svg>
									As a gift
								</button>
							</div>

							{#if forSelf}
								<div class="sp-recipient">
									{#if signedInUser.profileImageUrl}
										<img class="sp-avatar" src={signedInUser.profileImageUrl} alt="" aria-hidden="true" />
									{/if}
									<span>Badge goes to <strong>@{signedInUser.login}</strong></span>
								</div>
							{:else}
								<label class="sp-label" for="support-twitch">Gift to (Twitch username)</label>
								<div class="sp-input">
									<span class="sp-input-prefix" aria-hidden="true">@</span>
									<input
										id="support-twitch"
										aria-label="Twitch username"
										aria-describedby="support-account-status"
										autocomplete="off"
										autocapitalize="none"
										spellcheck={false}
										placeholder="Username"
										bind:value={twitchInput}
									/>
									<span class="sp-input-state">
										{#if accountState === 'found' && account}
											{#if account.profileImageUrl}
												<img class="sp-avatar" src={account.profileImageUrl} alt="" aria-hidden="true" />
											{:else}
												<span class="sp-check" aria-hidden="true">✓</span>
											{/if}
										{:else if accountState === 'waiting' || accountState === 'checking'}
											<span class="sp-spinner" aria-hidden="true"></span>
										{:else if accountState === 'error' || accountState === 'unavailable'}
											<span class="sp-warning" aria-hidden="true">!</span>
										{/if}
									</span>
								</div>
								<div
									id="support-account-status"
									class="sp-status is-{accountMessage ? accountState : 'tip'}"
									aria-live="polite"
								>
									{accountMessage || 'Who gets the badge?'}
								</div>
							{/if}

							{#if recipientHasIt}
								<p class="sp-owned is-taken" role="status">
									<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M8 4.5v4.2M8 11.2v.3" /></svg>
									{recipientHasIt}
								</p>
							{/if}

							{#if stripeReady || showPayPalButtons || showContinue}
								<p class="sp-pay-with">Pay <strong>{payLabel}</strong> with</p>
							{/if}
							<div class="sp-pay">
								{#if stripeReady}
									<button
										class="sp-stripe"
										type="button"
										disabled={!ready || checkoutBusy || stripeBusy}
										onclick={() => void payWithStripe()}
									>
										<svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><rect x="2" y="4.5" width="16" height="11" rx="2" /><path d="M2 8.2h16M5 12.4h3.5" /></svg>
										{stripeBusy ? 'Opening card checkout…' : 'Card, Apple Pay or Google Pay'}
									</button>
								{/if}
								{#if showPayPalButtons && paypalClientId}
									<PayPalButtons
										clientId={paypalClientId}
										cards={!stripeReady}
										disabled={!ready || checkoutBusy}
										createOrder={createButtonOrder}
										onApproved={confirmPayment}
										onCancelled={() => (outcome = { kind: 'cancelled' })}
										onFailed={paymentFailed}
										onUnavailable={payPalUnavailable}
									/>
								{:else if showContinue}
									<!-- Under the white card button it says where it goes, in PayPal's gold. -->
									<button class="sp-continue" class:is-paypal={stripeReady} type="submit" disabled={!ready || checkoutBusy}>
										{checkoutBusy ? 'Opening PayPal…' : stripeReady ? 'Continue to PayPal' : `Continue with ${payLabel}`}
									</button>
								{/if}
							</div>
							{#if checkoutBusy && showPayPalButtons}
								<p class="sp-status is-checking" role="status">Confirming your payment…</p>
							{/if}
							<p class="sp-fine">
								One-time payment. Sales are final once the badge unlocks.
								<span class="sp-fine-links">
									<a href={SUPPORT_TERMS_PATH}>Terms</a> · <a href="{SUPPORT_TERMS_PATH}#refunds">Refunds</a> ·
									<a href="mailto:{SUPPORT_CONTACT_EMAIL}">Contact</a>
								</span>
							</p>
						{:else if signIn !== 'unknown' && signIn.ready}
							<div class="sp-signin">
								<p class="sp-status">Sign in with Twitch to support. You can get a badge for yourself or gift one.</p>
								<a class="sp-continue sp-twitch" href={signInHref}>
									<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
										<path d="M4.3 3 3 6.3v13.2h4.5V22h2.5l2.5-2.5h3.7l5-5V3H4.3Zm15.2 10.6-2.9 2.9H12l-2.5 2.5v-2.5H5.8V4.7h13.7v8.9ZM16.3 7.6v5h-1.8v-5h1.8Zm-4.5 0v5H10v-5h1.8Z" />
									</svg>
									Sign in with Twitch
								</a>
								{#if signInMessage}
									<p class="sp-note{signInFailed ? ' is-error' : ''}" role="status">{signInMessage}</p>
								{/if}
							</div>
						{:else}
							<p class="sp-status">
								{signIn === 'unknown' ? 'Checking sign-in…' : 'Support is not available right now.'}
							</p>
						{/if}

						{#if submissionNote}
							<p class="sp-note" role="status">{submissionNote}</p>
						{/if}
						{#if outcome}
							<p class="sp-note{outcome.kind === 'error' ? ' is-error' : ''}" role="status">
								{outcome.kind === 'cancelled'
									? 'Payment cancelled. Nothing was charged.'
									: outcome.kind === 'pending'
										? 'PayPal is still processing this payment. Your badge appears once it clears.'
										: outcome.kind === 'error'
											? outcome.message
											: ''}
							</p>
						{/if}
					</fieldset>
				</form>
			{/if}
		</div>

		<p class="sp-addup">Payments add up. Already a supporter? You only pay the difference to the next tier.</p>

		{#if variant === 'page'}
			<footer class="sp-foot">
				<p>FlossChat is run by Gxufy and isn’t affiliated with Twitch, Kick, YouTube, TikTok, PayPal, Stripe or Link.</p>
				<p>
					<a href={SUPPORT_TERMS_PATH}>Terms</a> · <a href="{SUPPORT_TERMS_PATH}#privacy">Privacy</a> ·
					<a href="mailto:{SUPPORT_CONTACT_EMAIL}">{SUPPORT_CONTACT_EMAIL}</a>
				</p>
			</footer>
		{/if}
	</div>
</div>
<style>
	.sp,
	.sp *,
	.sp *::before,
	.sp *::after {
		box-sizing: border-box;
	}

	.sp {
		--bg: #0b0b0d;
		--card: #141416;
		--line: rgba(255, 255, 255, 0.08);
		--text: #f6f7fb;
		--muted: #9a9aa5;
		--dim: #6f6f7a;
		--accent: #4a84fa;
		--accent-2: #75a2ff;
		--ok: #7be0aa;
		--err: #ffaaa2;
		--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
		/* The site's spring (components/site/motion.ts, SPRING_EASING). */
		--spring: linear(0, 0.110 5%, 0.347 10%, 0.604 15%, 0.819 20%, 0.970 25%, 1.057 30%, 1.091 35%, 1.092 40%, 1.073 45%, 1.049 50%, 1.026 55%, 1.009 60%, 0.998 65%, 0.992 70%, 0.991 75%, 0.992 80%, 0.994 85%, 0.997 90%, 0.998 95%, 1);
		min-height: 100vh;
		margin: 0;
		padding: 26px 28px 64px;
		background:
			radial-gradient(ellipse 900px 420px at 50% -120px, rgba(74, 132, 250, 0.13), transparent),
			var(--bg);
		color: var(--text);
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	:where(.sp) button,
	:where(.sp) input {
		font: inherit;
		color: inherit;
	}

	.sp-shell {
		width: min(920px, 100%);
		margin: 0 auto;
	}

	.sp-back {
		display: inline-grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		color: #c9cedb;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.sp-back:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.06);
	}

	/* Heading */
	.sp-heading {
		margin: 40px auto 36px;
		text-align: center;
	}

	.sp-heading h1 {
		margin: 0;
		color: var(--text);
		font-size: clamp(34px, 5vw, 48px);
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1.05;
	}

	.sp-heading h1 em {
		font-style: normal;
		color: var(--accent);
	}

	.sp-heading p {
		max-width: 520px;
		margin: 14px auto 0;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.7;
	}

	.sp-mine {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-top: 14px;
		color: var(--accent-2);
		font-size: 13px;
		font-weight: 700;
		text-decoration: none;
	}

	.sp-mine svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.sp-mine:hover {
		color: #fff;
	}

	/* Cards */
	.sp-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
		align-items: stretch;
	}

	.sp-card {
		min-width: 0;
		margin: 0;
		border: 1px solid var(--line);
		border-radius: 22px;
		padding: 30px 26px 26px;
		background: var(--card);
	}

	.sp-card fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	/* The badge, and how it looks in chat */
	.sp-showcase {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	/* Chatlee-style stack: the picked badge in front, the others fanned behind. */
	.sp-stack {
		position: relative;
		width: 320px;
		height: 196px;
		margin: 0 auto 14px;
	}

	/* Just the badges: no card behind them. */
	.sp-stack-card {
		position: absolute;
		top: 18px;
		left: 50%;
		display: grid;
		place-items: center;
		width: 150px;
		height: 150px;
		margin-left: -75px;
		padding: 0;
		border: 0;
		border-radius: 24px;
		background: none;
		cursor: pointer;
		transform-origin: 50% 85%;
	}

	.sp-stack-card img {
		position: relative;
		width: 140px;
		height: 140px;
		object-fit: contain;
		filter: drop-shadow(0 12px 20px rgba(0, 0, 0, 0.45));
	}

	.sp-stack-card.is-front {
		z-index: 3;
		cursor: default;
	}

	.sp-stack-card.is-left,
	.sp-stack-card.is-right {
		z-index: 1;
		opacity: 0.72;
		filter: saturate(0.85) brightness(0.8);
	}

	.sp-stack-card.is-left {
		transform: translateX(-88px) translateY(12px) rotate(-12deg) scale(0.8);
	}

	.sp-stack-card.is-right {
		transform: translateX(88px) translateY(12px) rotate(12deg) scale(0.8);
	}

	.sp-stack-card.is-left:hover,
	.sp-stack-card.is-right:hover {
		opacity: 0.95;
		filter: none;
	}

	.sp-stack-hint {
		margin: 6px 0 0;
		color: var(--dim);
		font-size: 11px;
	}

	.sp-showcase h2 {
		margin: 0 0 8px;
		color: #f0f3fb;
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1.2;
	}

	.sp-showcase h2 span {
		color: var(--accent);
	}

	.sp-reward {
		max-width: 300px;
		margin: 0;
		color: #9299aa;
		font-size: 12px;
		line-height: 1.65;
	}

	.sp-chat {
		width: 100%;
		margin-top: 22px;
		min-height: 72px;
		display: grid;
		align-items: center;
		border: 1px solid #2c2c35;
		border-radius: 12px;
		padding: 16px 18px;
		background: repeating-conic-gradient(#1a1a20 0% 25%, #131318 0% 50%) 0 0 / 16px 16px;
		box-shadow: inset 0 2px 12px rgba(0, 0, 0, 0.3);
	}

	/* Sizes are multiplied by --sp-chat-scale, which fitChatLine sets below 1
	   when the line wouldn't fit on one line at full size. */
	.sp-chat-row {
		--sp-chat-font: 22px;
		--sp-chat-badge: 28px;
		--sp-chat-gap: 5px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		column-gap: calc(var(--sp-chat-gap) * var(--sp-chat-scale, 1));
		row-gap: 6px;
		min-height: 32px;
		color: #fff;
		font-size: calc(var(--sp-chat-font) * var(--sp-chat-scale, 1));
		font-weight: 800;
		line-height: 1.2;
		text-shadow: rgba(0, 0, 0, 0.8) 2px 3px 0.15rem;
	}

	.sp-chat-badge {
		width: calc(var(--sp-chat-badge) * var(--sp-chat-scale, 1));
		height: calc(var(--sp-chat-badge) * var(--sp-chat-scale, 1));
		object-fit: contain;
		border-radius: 2px;
		filter: drop-shadow(rgba(0, 0, 0, 0.8) 1px 2px 2px);
	}

	.sp-chat-badge.is-feature {
		object-fit: fill;
		border-radius: 0;
	}

	/* Name and message in one flex item, so on a narrow screen the line can
	   only wrap after "name:", never between the name and its colon. */
	.sp-chat-line {
		min-width: 0;
		margin-left: calc(4px * var(--sp-chat-scale, 1));
		text-align: center;
		overflow-wrap: anywhere;
	}

	.sp-chat-name {
		color: #92b5ff;
		letter-spacing: -0.01em;
	}

	.sp-chat-text {
		font-weight: 600;
	}

	.sp-chat-status {
		min-height: 17px;
		margin: 10px 0 0;
		color: #737b8e;
		font-size: 11px;
		line-height: 1.5;
	}

	/* Price */
	.sp-price {
		display: flex;
		justify-content: center;
		align-items: baseline;
		gap: 2px;
		margin-bottom: 6px;
		color: #f5f7ff;
		font-size: 64px;
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1.15;
	}

	.sp-currency-symbol {
		color: var(--accent);
	}

	.sp-amount {
		display: inline-grid;
		font: inherit;
		color: inherit;
	}

	.sp-amount-sizer,
	.sp-amount-digits {
		grid-area: 1 / 1;
		padding: 0 0.02em;
		border: 0;
		border-bottom: 2px solid transparent;
		font: inherit;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.04em;
		white-space: pre;
	}

	.sp-amount-sizer {
		visibility: hidden;
	}

	.sp-amount-digits {
		display: block;
		overflow: hidden;
		pointer-events: none;
	}

	.sp-digit {
		display: inline-block;
	}

	.sp-currency {
		margin-left: 7px;
		color: #6f8fd8;
		font-size: 11px;
		font-weight: 750;
		letter-spacing: 0.08em;
	}

	.sp-hint {
		margin: 0 0 18px;
		color: var(--dim);
		font-size: 12px;
		text-align: center;
	}

	/* "Your earlier payments count": a little brighter, like good news. */
	.sp-hint.is-credit {
		color: #7fd8a6;
	}

	/* Badge tiers: three pills under the price, the picked one lit in the page
	   blue, a check on tiers already held. */
	.sp-tiers {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		margin: 0 0 4px;
	}

	/* Custom: a slimmer pill across the row under the three tiers. */
	.sp-tier.is-custom {
		grid-column: 1 / -1;
		flex-direction: row;
		justify-content: center;
		gap: 8px;
		padding: 7px 10px;
	}

	.sp-tier {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 0;
		padding: 9px 6px 8px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.04);
		color: rgba(255, 255, 255, 0.72);
		font: inherit;
		cursor: pointer;
		transition:
			border-color 0.18s,
			background 0.18s,
			color 0.18s;
	}

	.sp-tier:hover {
		border-color: rgba(255, 255, 255, 0.18);
		color: #fff;
	}

	.sp-tier[aria-checked='true'] {
		border-color: rgba(74, 132, 250, 0.75);
		background: radial-gradient(closest-side, rgba(74, 132, 250, 0.26), rgba(74, 132, 250, 0.08));
		color: #fff;
	}

	.sp-tier-name {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
		font-weight: 800;
	}

	.sp-tier-name svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.sp-tier-price {
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.sp-tier[aria-checked='true'] .sp-tier-price {
		color: rgba(214, 227, 255, 0.92);
	}

	.sp-tier.is-have .sp-tier-price {
		color: #8fb4ff;
	}

	/* A badge's price: set by the server, so no − / + and no typing. */
	.sp-price.is-fixed {
		justify-content: center;
	}

	/* Custom: the digits are a text box, with − / + either side. The hidden
	   copy of the digits sizes it; the box lies over that copy. */
	.sp-price.is-custom {
		align-items: center;
	}

	.sp-price.is-custom .sp-amount {
		position: relative;
	}

	.sp-amount-input {
		position: absolute;
		inset: 0;
		width: 100%;
		min-width: 0;
		padding: 0 0.02em;
		border: 0;
		border-bottom: 2px dashed rgba(143, 180, 255, 0.45);
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.04em;
		outline: none;
		caret-color: var(--accent);
	}

	.sp-amount-input:focus {
		border-bottom-color: var(--accent);
	}

	.sp-step {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 34px;
		height: 34px;
		margin: 0 12px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.05);
		color: #f5f7ff;
		cursor: pointer;
		transition:
			background 0.18s,
			border-color 0.18s;
	}

	.sp-step svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	.sp-step:hover:not(:disabled) {
		border-color: rgba(143, 180, 255, 0.5);
		background: rgba(74, 132, 250, 0.16);
	}

	.sp-step:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.sp-step:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* "Pick $5 to $500": the amount box holds something outside that. */
	.sp-hint.is-limit {
		color: #f0a06b;
	}

	/* The Founder card: the badge, the first FOUNDER_LIMIT, and how many are left. */
	.sp-first {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 18px;
		margin: 0 auto 24px;
		padding: 16px 22px 16px 16px;
	}

	.sp-first-badge {
		width: 64px;
		height: 64px;
		object-fit: contain;
		filter: drop-shadow(0 8px 18px rgba(65, 113, 235, 0.3));
	}

	.sp-first-kicker {
		color: var(--accent-2);
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.sp-first h2 {
		margin: 2px 0 4px;
		color: #f0f3fb;
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}

	.sp-first p {
		margin: 0;
		color: #9299aa;
		font-size: 12px;
		line-height: 1.55;
	}

	.sp-first-count {
		display: grid;
		justify-items: end;
		gap: 2px;
		min-width: 96px;
	}

	.sp-first-count strong {
		color: #f5f7ff;
		font-size: 26px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.sp-first-count strong span {
		color: var(--dim);
		font-size: 13px;
		font-weight: 700;
	}

	.sp-first-left {
		color: var(--dim);
		font-size: 11px;
	}

	.sp-first-bar {
		display: block;
		width: 96px;
		height: 4px;
		margin-top: 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}

	.sp-first-bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #3d6fe6, #8fb4ff);
	}

	/* Under the cards: how payments add up. */
	.sp-addup {
		margin: 18px auto 0;
		color: var(--dim);
		font-size: 12px;
		text-align: center;
	}

	.sp-switch {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin: 14px 0 12px;
		padding: 4px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.05);
	}

	.sp-switch-pill {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 6px);
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.12);
		box-shadow: inset 0 1px rgba(255, 255, 255, 0.06);
	}

	.sp-switch[data-on='gift'] .sp-switch-pill {
		translate: calc(100% + 4px) 0;
	}

	.sp-switch button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 9px 10px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.86rem;
		font-weight: 700;
		cursor: pointer;
	}

	.sp-switch button[aria-checked='true'] {
		color: #fff;
	}

	.sp-switch button:disabled {
		color: rgba(255, 255, 255, 0.28);
		cursor: not-allowed;
	}

	.sp-switch svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Who gets it */
	.sp-recipient {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.05);
		font-size: 0.92rem;
	}

	.sp-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		outline: 1px solid rgba(255, 255, 255, 0.09);
	}

	.sp-label {
		display: block;
		margin-top: 18px;
		color: #e6e6ea;
		font-size: 12px;
		font-weight: 760;
	}


	.sp-input {
		display: flex;
		align-items: center;
		margin-top: 9px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		background: #0e0e10;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.sp-input:focus-within {
		border-color: rgba(74, 132, 250, 0.6);
		box-shadow: 0 0 0 3px rgba(74, 132, 250, 0.18);
	}

	.sp-input-prefix {
		padding-left: 17px;
		color: #7f8697;
		font-size: 15px;
	}

	.sp-input input {
		flex: 1;
		width: 100%;
		min-width: 0;
		height: 50px;
		padding: 0 10px;
		border: 0;
		outline: 0;
		background: transparent;
		color: #f1f3fa;
		font-size: 14px;
	}

	.sp-input input::placeholder {
		color: #686e7d;
	}

	.sp-input-state {
		display: grid;
		place-items: center;
		min-width: 46px;
		padding-right: 11px;
	}

	.sp-check,
	.sp-warning {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 999px;
		font-size: 14px;
		font-weight: 900;
	}

	.sp-check {
		background: rgba(81, 195, 138, 0.13);
		color: var(--ok);
	}

	.sp-warning {
		background: rgba(255, 120, 112, 0.11);
		color: var(--err);
	}

	.sp-spinner {
		width: 19px;
		height: 19px;
		border: 2px solid rgba(255, 255, 255, 0.12);
		border-top-color: #84aaff;
		border-radius: 999px;
		animation: sp-spin 0.8s linear infinite;
	}

	.sp-status {
		display: flex;
		align-items: center;
		min-height: 38px;
		margin: 0;
		padding: 4px 1px;
		color: #818898;
		font-size: 11px;
		line-height: 1.45;
	}

	.sp-status.is-found {
		color: #83d7ac;
	}

	.sp-status.is-tip {
		color: #b8cbf5;
	}

	.sp-status.is-error,
	.sp-status.is-unavailable {
		color: #e7aaa4;
	}

	.sp-owned {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid rgba(81, 195, 138, 0.18);
		border-radius: 11px;
		background: rgba(81, 195, 138, 0.07);
		color: #a9e6c6;
		font-size: 12px;
		line-height: 1.5;
	}

	.sp-owned.is-taken {
		border-color: rgba(255, 120, 112, 0.22);
		background: rgba(255, 120, 112, 0.07);
		color: #f2bdb7;
	}

	.sp-owned svg {
		flex: none;
		margin-top: 2px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Pay */
	.sp-continue {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		width: 100%;
		min-height: 50px;
		padding: 0 17px;
		border: 1px solid #fff;
		border-radius: 999px;
		background: #fff;
		color: #111;
		font-size: 15px;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color 0.15s,
			opacity 0.15s;
	}

	.sp-continue:hover:not(:disabled) {
		background: #e9e9ee;
	}

	.sp-continue.is-paypal {
		border-color: #ffc439;
		background: #ffc439;
	}

	.sp-continue.is-paypal:hover:not(:disabled) {
		border-color: #f2b52e;
		background: #f2b52e;
	}

	.sp-continue:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.sp-twitch {
		border-color: #9146ff;
		background: #9146ff;
		color: #fff;
		box-shadow: 0 6px 20px rgba(145, 70, 255, 0.3);
	}

	.sp-twitch:hover {
		background: #a167ff;
	}

	.sp-pay-with {
		margin: 4px 0 10px;
		color: var(--muted);
		font-size: 12px;
		text-align: center;
	}

	.sp-pay-with strong {
		color: #fff;
	}

	.sp-pay {
		display: grid;
		gap: 8px;
	}

	/* White, like Chatlee's card button; PayPal's gold Buy Now goes under it. */
	.sp-stripe {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		width: 100%;
		min-height: 48px;
		padding: 0 17px;
		border: 1px solid #fff;
		border-radius: 999px;
		background: #fff;
		color: #111318;
		font-size: 14px;
		font-weight: 750;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s,
			opacity 0.15s;
	}

	.sp-stripe svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}

	.sp-stripe:hover:not(:disabled) {
		border-color: #e6e8ee;
		background: #e6e8ee;
	}

	.sp-stripe:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.sp-signin {
		display: grid;
		gap: 14px;
	}

	.sp-signin .sp-note {
		margin: 0;
	}

	.sp-fine {
		margin: 12px 0 0;
		color: var(--dim);
		font-size: 11px;
		line-height: 1.6;
		text-align: center;
	}

	.sp-fine-links {
		display: block;
	}

	.sp-fine a,
	.sp-foot a {
		color: #9a9fae;
		text-underline-offset: 2px;
	}

	.sp-fine a:hover,
	.sp-foot a:hover {
		color: #fff;
	}

	.sp-note {
		margin: 12px 0 0;
		padding: 11px 12px;
		border: 1px solid rgba(117, 162, 255, 0.2);
		border-radius: 11px;
		background: rgba(78, 123, 225, 0.07);
		color: #b8cbf5;
		font-size: 12px;
		line-height: 1.55;
	}

	.sp-note.is-error {
		border-color: rgba(255, 120, 112, 0.22);
		background: rgba(255, 120, 112, 0.07);
		color: #f2bdb7;
	}

	/* Thank you */
	.sp-thanks {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.sp-thanks-actions {
		display: grid;
		gap: 10px;
		width: 100%;
		max-width: 300px;
		margin-top: 22px;
	}

	.sp-continue.is-quiet {
		border-color: rgba(255, 255, 255, 0.14);
		background: transparent;
		color: var(--text);
	}

	.sp-continue.is-quiet:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.sp-thanks-badge {
		width: 72px;
		height: 72px;
		object-fit: contain;
	}

	.sp-thanks h2 {
		margin: 10px 0 8px;
		color: var(--text);
		font-size: 30px;
		font-weight: 800;
		letter-spacing: -0.035em;
	}

	.sp-thanks p {
		margin: 0;
		color: #a4a9b8;
		font-size: 14px;
		line-height: 1.6;
	}

	.sp-thanks strong {
		color: #fff;
	}

	.sp-link {
		display: inline-block;
		margin-top: 10px;
		color: #9fc0ff;
		font-weight: 700;
		text-decoration: none;
	}

	.sp-foot {
		margin-top: 40px;
		color: #5f636e;
		font-size: 11.5px;
		line-height: 1.8;
		text-align: center;
	}

	.sp-foot p {
		margin: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.sp-back:focus-visible,
	.sp-mine:focus-visible,
	.sp-tier:focus-visible,
	.sp-stack-card:focus-visible,
	.sp-switch button:focus-visible,
	.sp-continue:focus-visible,
	.sp-stripe:focus-visible,
	.sp-link:focus-visible,
	.sp-fine a:focus-visible,
	.sp-foot a:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}

	/* Inside the generator's Support popup */
	.sp.is-modal {
		min-height: 0;
		padding: 0;
		background: transparent;
	}

	.sp.is-modal .sp-heading {
		margin: 0 auto 24px;
	}

	.sp.is-modal .sp-heading h1 {
		font-size: clamp(30px, 4vw, 40px);
	}

	@media (max-width: 760px) {
		.sp {
			padding: 20px 20px 46px;
		}

		.sp-heading {
			margin: 28px auto 26px;
		}

		.sp-grid {
			grid-template-columns: 1fr;
			gap: 16px;
		}

		.sp-price {
			font-size: 54px;
		}
	}

	@media (max-width: 420px) {
		.sp-card {
			padding: 24px 18px 20px;
		}

		.sp-first {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.sp-first-count {
			grid-column: 1 / -1;
			justify-items: start;
		}

		/* A phone fits "badge YourNameHere: hey chat" on one line; more badges
		   or a longer name are drawn smaller to fit (fitChatLine). */
		.sp-chat {
			padding: 14px 12px;
		}

		.sp-chat-row {
			--sp-chat-font: 18px;
			--sp-chat-badge: 24px;
			--sp-chat-gap: 4px;
		}

		.sp-step {
			margin: 0 8px;
		}
	}

	/* Motion: springs and gentle loops, only for people who haven't asked
	   their system for less motion. */
	@media (prefers-reduced-motion: no-preference) {
		.sp-tier {
			transition:
				border-color 0.18s,
				background 0.18s,
				color 0.18s,
				transform 0.35s var(--spring);
		}

		.sp-tier:active {
			transform: scale(0.96);
		}

		.sp-card {
			animation: sp-rise 0.5s var(--ease-out) backwards;
		}

		.sp-grid > .sp-card:nth-child(2) {
			animation-delay: 0.06s;
		}

		.sp-stack-card {
			transition:
				transform 0.55s var(--spring),
				opacity 0.3s,
				filter 0.3s;
		}

		.sp-stack-card.is-front img {
			animation: sp-float 5.5s ease-in-out infinite;
		}

		.sp-first-bar span {
			transition: width 0.8s var(--ease-out);
		}

		.sp-digit.is-up {
			animation: sp-roll-up 0.55s var(--spring) both;
		}

		.sp-switch-pill {
			transition: translate 0.5s var(--spring);
		}

		.sp-switch button {
			transition:
				color 0.15s,
				scale 0.4s var(--spring);
		}

		.sp-continue,
		.sp-stripe,
		.sp-back {
			transition:
				color 0.15s,
				border-color 0.15s,
				background-color 0.15s,
				opacity 0.15s,
				scale 0.45s var(--spring);
		}

		.sp-switch button:active:not(:disabled) {
			scale: 0.92;
		}

		.sp-continue:active:not(:disabled),
		.sp-stripe:active:not(:disabled),
		.sp-back:active {
			scale: 0.97;
		}

		.sp-mine svg {
			transition: translate 0.3s var(--spring);
		}

		.sp-mine:hover svg {
			translate: 3px 0;
		}

		.sp-check,
		.sp-warning,
		.sp-input-state .sp-avatar,
		.sp-thanks-badge,
		.sp-chat-badge.is-feature {
			animation: sp-pop 0.45s var(--spring) both;
		}

		.sp-owned,
		.sp-note {
			animation: sp-fade-up 0.3s var(--ease-out) both;
		}
	}

	@keyframes sp-rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
	}

	@keyframes sp-float {
		50% {
			transform: translateY(-6px) rotate(-1.5deg);
		}
	}

	@keyframes sp-roll-up {
		from {
			opacity: 0;
			transform: translateY(0.55em);
		}
	}

	@keyframes sp-pop {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}

	@keyframes sp-fade-up {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	@keyframes sp-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
