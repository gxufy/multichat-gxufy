import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

/* Badge cosmetics come from many providers; these tests are about checkout. */
vi.mock('@/features/multichat/previewIdentityClient', () => ({
	cachedPreviewIdentity: () => null,
	acquirePreviewIdentity: () => ({
		promise: new Promise(() => {}),
		enrichment: Promise.resolve(),
		release: () => {}
	})
}));
vi.mock('@/features/multichat/previewBttvPro', () => ({ loadPreviewBttvProBadges: async () => new Map() }));
vi.mock('@/lib/communityBadges', () => ({ resolveTwitchJilChatBadges: async () => [] }));

import SupportCheckout from './SupportCheckout.svelte';

const BUYER = { id: '999', login: 'buyer', displayName: 'Buyer' };
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Api = {
	me?: Response;
	ready?: boolean;
	founderSlotsLeft?: number;
	user?: (login: string) => Response;
	checkout?: Response;
	capture?: Response;
};
const posts: { url: string; body: unknown }[] = [];

function mockApi(api: Api = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body ?? 'null')) });
			if (url === '/api/auth/me') return api.me ?? json({ signInReady: true, user: BUYER, badges: [] });
			if (url === '/api/support/status') return json({ checkoutReady: api.ready ?? true, signInReady: true, founderSlotsLeft: api.founderSlotsLeft });
			if (url.startsWith('/api/twitch/support-user?login=')) {
				const login = decodeURIComponent(url.split('=')[1]);
				return api.user ? api.user(login) : json({ id: '777', login, displayName: 'Friend_01' });
			}
			if (url === '/api/support/checkout') return api.checkout ?? json({ error: 'Checkout is off in tests.' }, 503);
			if (url === '/api/support/capture') return api.capture ?? json({ status: 'completed', recipient: { login: 'buyer', displayName: 'Buyer' } });
return json({}, 404);
		})
	);
}

const path = window.location.pathname;
const continueButton = () => page.getByRole('button', { name: /^Continue with/ });

beforeEach(() => {
	posts.length = 0;
	window.history.replaceState(window.history.state, '', path);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('support checkout (SvelteKit)', () => {
	it('asks a signed-out visitor to sign in with Twitch first', async () => {
		mockApi({ me: json({ signInReady: true, user: null }) });
		await render(SupportCheckout);
		await expect
			.element(page.getByRole('link', { name: 'Sign in with Twitch' }))
			.toHaveAttribute('href', '/api/auth/twitch/login?next=%2Fsupport');
		await expect.element(continueButton()).not.toBeInTheDocument();
	});

	it('back from a failed Twitch sign-in: says so, and the URL is cleaned', async () => {
		window.history.replaceState(window.history.state, '', `${path}?signin=failed`);
		mockApi({ me: json({ signInReady: true, user: null }) });
		await render(SupportCheckout);
		await expect.element(page.getByText('Sign-in did not work. Please try again.')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Sign in with Twitch' })).toBeInTheDocument();
		expect(window.location.search).toBe('');
	});

	it('back from a cancelled Twitch sign-in: a plain note', async () => {
		window.history.replaceState(window.history.state, '', `${path}?signin=cancelled`);
		mockApi({ me: json({ signInReady: true, user: null }) });
		await render(SupportCheckout);
		await expect.element(page.getByText('Sign-in was cancelled.')).toBeInTheDocument();
		expect(window.location.search).toBe('');
	});

	it('says support is not available when sign-in is not set up', async () => {
		mockApi({ me: json({}, 503) });
		await render(SupportCheckout);
		await expect.element(page.getByText('Support is not available right now.')).toBeInTheDocument();
	});

	it('three badge tiers and Custom: no "no badge" choice, and the amount box only with Custom', async () => {
		mockApi();
		const screen = await render(SupportCheckout);
		await expect.element(page.getByRole('radio', { name: /^Sanctioned/ })).toBeInTheDocument();
		expect(
			[...screen.container.querySelectorAll('.sp-tiers [role="radio"]')].map((radio) => radio.getAttribute('data-choice'))
		).toEqual(['supporter', 'suvy', 'top-suvy', 'custom']);
		await expect.element(page.getByRole('radio', { name: /^No badge/ })).not.toBeInTheDocument();
		await expect.element(page.getByRole('textbox', { name: /Amount in US dollars/ })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '$1 more' })).not.toBeInTheDocument();
		await expect.element(page.getByText('Payments add up. Already a supporter? You only pay the difference to the next tier.')).toBeInTheDocument();
	});

	it('for you: the badge goes to the signed-in account, and only PayPal is followed', async () => {
		mockApi({ checkout: json({ approveUrl: 'https://evil.example/pay' }) });
		await render(SupportCheckout);
		await expect.element(page.getByText(/Badge goes to/)).toHaveTextContent('Badge goes to @buyer');
		await continueButton().click();
		await expect.element(page.getByText('Checkout is not available right now.')).toBeInTheDocument();
		expect(posts).toEqual([{ url: '/api/support/checkout', body: { tier: 'supporter', forSelf: true } }]);
	});

	it('as a gift: checks the Twitch name before continuing', async () => {
		mockApi({ checkout: json({ error: 'PayPal is not answering.' }, 503) });
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		const name = page.getByRole('textbox', { name: 'Twitch username' });
		await name.fill('ab');
		await expect.element(page.getByText('Use at least 3 characters.')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
		await name.fill('@Friend_01');
		await expect.element(page.getByText('Verified as Friend_01.')).toBeInTheDocument();
		await expect.element(page.getByText('Friend_01', { exact: true })).toBeInTheDocument();
		await continueButton().click();
		await expect.element(page.getByText('PayPal is not answering.')).toBeInTheDocument();
		expect(posts).toEqual([{ url: '/api/support/checkout', body: { tier: 'supporter', login: 'friend_01' } }]);
	});

	it('as a gift: an unknown Twitch name cannot continue', async () => {
		mockApi({ user: () => json({ error: 'not found' }, 404) });
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await page.getByRole('textbox', { name: 'Twitch username' }).fill('nobody_here');
		await expect.element(page.getByText('No Twitch account found.')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
	});

	it('never charges while checkout is not set up', async () => {
		mockApi({ ready: false });
		await render(SupportCheckout);
		await continueButton().click();
		await expect.element(page.getByText(/Checkout is not connected yet/)).toBeInTheDocument();
		expect(posts).toEqual([]);
	});

	it('back from PayPal, cancelled: nothing was charged, and the URL is cleaned', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=cancel`);
		mockApi();
		await render(SupportCheckout);
		await expect.element(page.getByText('Payment cancelled. Nothing was charged.')).toBeInTheDocument();
		expect(window.location.search).toBe('');
		expect(posts).toEqual([]);
	});

	it('back from PayPal, paid: the server confirms before saying thank you', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=ABCDEFGHIJ12`);
		mockApi();
		await render(SupportCheckout);
		await expect.element(page.getByText('Thank you!')).toBeInTheDocument();
		await expect.element(page.getByText(/Your FlossChat badge is on\./)).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'See your badge' })).toHaveAttribute('href', '/badges');
		await expect.element(page.getByRole('link', { name: 'Back to FlossChat' })).toHaveAttribute('href', '/');
		await expect.element(page.getByRole('button', { name: 'Gift another' })).not.toBeInTheDocument();
		expect(posts).toEqual([{ url: '/api/support/capture', body: { orderId: 'ABCDEFGHIJ12' } }]);
	});

	it('after buying a tier: names that tier', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=ABCDEFGHIJ12`);
		mockApi({ capture: json({ status: 'completed', recipient: { login: 'buyer', displayName: 'Buyer' }, tier: 'suvy' }) });
		await render(SupportCheckout);
		await expect.element(page.getByText(/Your Suvy badge is on\./)).toBeInTheDocument();
	});

	it('after a gift: names who got it, and "Gift another" goes back to an empty gift form', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=ABCDEFGHIJ12`);
		mockApi({ capture: json({ status: 'completed', recipient: { login: 'friend_01', displayName: 'Friend_01' } }) });
		await render(SupportCheckout);
		await expect.element(page.getByText(/now has the FlossChat badge/)).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'See your badge' })).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Gift another' }).click();
		await expect.element(page.getByRole('radio', { name: 'As a gift' })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('textbox', { name: 'Twitch username' })).toHaveValue('');
		await expect.element(page.getByRole('textbox', { name: 'Twitch username' })).toHaveFocus();
	});

	it('after a tip with no badge: just thanks, and a way back', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=ABCDEFGHIJ12`);
		mockApi({ capture: json({ status: 'completed', recipient: null }) });
		await render(SupportCheckout);
		await expect.element(page.getByText('Your support means a lot.')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Back to FlossChat' })).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'See your badge' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Gift another' })).not.toBeInTheDocument();
	});

	it('a gift needs a name before anything can be paid', async () => {
		mockApi();
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await expect.element(page.getByText('Who gets the badge?')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
		expect(posts).toEqual([]);
	});

	it('each tier shows its price, its badge art and name; the price follows the tier', async () => {
		mockApi();
		const screen = await render(SupportCheckout);
		await expect.element(page.getByRole('radio', { name: /^Sanctioned/ })).toHaveTextContent('Sanctioned $5');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveTextContent('Suvy $10');
		await expect.element(page.getByRole('radio', { name: /^Top Suvy/ })).toHaveTextContent('Top Suvy $20');
		await expect.element(page.getByRole('heading', { name: 'Sanctioned badge' })).toBeInTheDocument();
		await page.getByRole('radio', { name: /^Top Suvy/ }).click();
		await expect.element(page.getByRole('heading', { name: 'Top Suvy badge' })).toBeInTheDocument();
		await expect.element(continueButton()).toHaveTextContent('Continue with $20');
		expect(screen.container.querySelector('.sp-stack-card.is-front img')?.getAttribute('src')).toBe('/badges/gxufy/top-suvy-hand.webp');
		await expect.element(page.getByRole('button', { name: '$1 more' })).not.toBeInTheDocument();
	});

	it('arrow keys move between the tiers; only the picked one is in the tab order', async () => {
		mockApi();
		await render(SupportCheckout);
		const sanctioned = page.getByRole('radio', { name: /^Sanctioned/ });
		await expect.element(sanctioned).toHaveAttribute('tabindex', '0');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveAttribute('tabindex', '-1');
		(sanctioned.element() as HTMLElement).focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveFocus();
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
		await expect.element(page.getByRole('radio', { name: /^Custom/ })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('radio', { name: /^Custom/ })).toHaveFocus();
		await userEvent.keyboard('{ArrowLeft}');
		await expect.element(page.getByRole('radio', { name: /^Top Suvy/ })).toHaveAttribute('aria-checked', 'true');
	});

	it('Custom: any amount from $5 to $500 gets the best badge it reaches, shown before paying', async () => {
		mockApi();
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Custom/ }).click();
		const amount = page.getByRole('textbox', { name: /Amount in US dollars/ });
		await expect.element(amount).toHaveFocus();
		await expect.element(amount).toHaveValue('15');
		/* $15: past Suvy's $10, $5 short of Top Suvy. */
		await expect.element(page.getByText('Gets you Suvy. $5 more later reaches Top Suvy.')).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Suvy badge' })).toBeInTheDocument();
		await expect.element(continueButton()).toHaveTextContent('Continue with $15');

		await amount.fill('25');
		await expect.element(page.getByText('Gets you Top Suvy.')).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Top Suvy badge' })).toBeInTheDocument();

		/* Under $5 or over $500 can't be paid; leaving the box pulls it back in. */
		await amount.fill('3');
		await expect.element(page.getByText('Pick $5 to $500.')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
		await page.getByRole('button', { name: '$1 more' }).click();
		await expect.element(amount).toHaveValue('5');
		await expect.element(page.getByText('Gets you Sanctioned. $5 more later reaches Suvy.')).toBeInTheDocument();
		await amount.fill('9000');
		(amount.element() as HTMLInputElement).blur();
		await expect.element(amount).toHaveValue('500');
		await expect.element(page.getByRole('button', { name: '$1 more' })).toBeDisabled();

		await amount.fill('7.5');
		await continueButton().click();
		expect(posts).toEqual([{ url: '/api/support/checkout', body: { amountCents: 750, forSelf: true } }]);
	});

	it('Custom for someone who already has a badge: it counts toward the next one', async () => {
		mockApi({
			me: json({
				signInReady: true,
				user: BUYER,
				badges: [],
				standing: { tier: 'suvy', founder: false, prices: { supporter: null, suvy: null, 'top-suvy': 1000 } }
			})
		});
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Custom/ }).click();
		const amount = page.getByRole('textbox', { name: /Amount in US dollars/ });
		await amount.fill('6');
		await expect.element(page.getByText('You have Suvy; this counts toward Top Suvy. $4 more later reaches Top Suvy.')).toBeInTheDocument();
		/* Never the "already have it" stop: any amount is open to them. */
		await expect.element(page.getByText(/already have/)).not.toBeInTheDocument();
		await expect.element(continueButton()).toBeEnabled();
		await amount.fill('10');
		await expect.element(page.getByText('Gets you Top Suvy.')).toBeInTheDocument();
	});

	it('the Founder card shows the badge, the first 25, and how many are claimed', async () => {
		mockApi({ founderSlotsLeft: 12 });
		const screen = await render(SupportCheckout);
		await expect.element(page.getByRole('heading', { name: 'The first 25 supporters' })).toBeInTheDocument();
		await expect.element(page.getByAltText('FlossChat Founder badge')).toHaveAttribute('src', '/badges/gxufy/founder-hand.webp');
		await expect.element(page.getByText('claimed', { exact: true })).toBeInTheDocument();
		expect(screen.container.querySelector('.sp-first-count strong')?.textContent?.replace(/\s+/g, '')).toBe('13/25');
		await expect.element(page.getByRole('progressbar', { name: 'Founder badges taken' })).toHaveAttribute('aria-valuenow', '13');
	});

	it('the Founder card says when all 25 are taken', async () => {
		mockApi({ founderSlotsLeft: 0 });
		await render(SupportCheckout);
		await expect.element(page.getByText('All 25 Founder badges have been taken. Thank you.')).toBeInTheDocument();
	});

	it('the badge stack: the picked badge in front; tapping one behind picks that tier', async () => {
		mockApi();
		const screen = await render(SupportCheckout);
		await expect.element(page.getByRole('button', { name: 'Sanctioned badge' })).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Top Suvy badge' }).click();
		await expect.element(page.getByRole('radio', { name: /^Top Suvy/ })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('button', { name: 'Top Suvy badge' })).toHaveAttribute('aria-pressed', 'true');
		expect(screen.container.querySelector('.sp-stack-card.is-left img')?.getAttribute('src')).toBe('/badges/gxufy/suvy-hand.webp');
		expect(screen.container.querySelector('.sp-stack-card.is-right img')?.getAttribute('src')).toBe('/badges/gxufy/supporter-hand.webp');
	});

	it('back from PayPal with a bad token: asks nothing of the server', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=../../x`);
		mockApi();
		await render(SupportCheckout);
		await expect.element(continueButton()).toBeInTheDocument();
		expect(posts).toEqual([]);
	});

	it('says so when PayPal could not confirm the payment', async () => {
		window.history.replaceState(window.history.state, '', `${path}?paypal=return&token=ABCDEFGHIJ12`);
		mockApi({ capture: json({ error: 'x' }, 409) });
		await render(SupportCheckout);
		await expect.element(page.getByText(/We could not confirm that payment/)).toBeInTheDocument();
	});

	it('a supporter starts on the next tier and moves up for the difference; a tier they have says "Have it"', async () => {
		const standing = { tier: 'supporter', founder: false, owner: false, prices: { supporter: null, suvy: 500, 'top-suvy': 1500 } };
		mockApi({ me: json({ signInReady: true, user: BUYER, badges: [{ id: 'supporter', owned: true, worn: true }], standing }) });
		await render(SupportCheckout);
		await expect.element(page.getByRole('radio', { name: /^Sanctioned/ })).toHaveTextContent('Sanctioned Have it');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('radio', { name: /^Suvy/ })).toHaveTextContent('Suvy $10');
		await expect.element(page.getByRole('img', { name: '$5 US dollars' })).toBeInTheDocument();
		await expect.element(page.getByText('Your earlier payments count (instead of $10).')).toBeInTheDocument();
		await expect.element(continueButton()).toHaveTextContent('Continue with $5');
		await page.getByRole('radio', { name: /^Sanctioned/ }).click();
		await expect.element(page.getByText('You already have Sanctioned. Pick a higher tier, or gift one.')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
		await page.getByRole('radio', { name: /^Top Suvy/ }).click();
		await expect.element(continueButton()).toHaveTextContent('Continue with $15');
		await expect.element(page.getByText('Your earlier payments count (instead of $20).')).toBeInTheDocument();
		await continueButton().click();
		expect(posts[0]).toEqual({ url: '/api/support/checkout', body: { tier: 'top-suvy', forSelf: true } });
	});

	it('won’t gift a tier the recipient already has', async () => {
		const standing = { tier: 'top-suvy', founder: true, owner: false, prices: { supporter: null, suvy: null, 'top-suvy': null } };
		mockApi({ user: (login) => json({ id: '777', login, displayName: 'Friend_01', standing }) });
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await page.getByRole('textbox', { name: 'Twitch username' }).fill('friend_01');
		await expect.element(page.getByText('Friend_01 already has Top Suvy, the highest tier. Pick someone else.')).toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();
		expect(posts).toEqual([]);
	});

	it('says nothing extra when the recipient does not have it yet', async () => {
		mockApi();
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await page.getByRole('textbox', { name: 'Twitch username' }).fill('friend_01');
		await expect.element(page.getByText('Verified as Friend_01.')).toBeInTheDocument();
		await expect.element(page.getByText(/already has/)).not.toBeInTheDocument();
	});

	it('links the terms, the refund rules and the contact email next to the button', async () => {
		mockApi();
		await render(SupportCheckout);
		await expect.element(page.getByRole('link', { name: 'Terms' }).first()).toHaveAttribute('href', '/support/terms');
		await expect.element(page.getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/support/terms#refunds');
		await expect.element(page.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', 'mailto:unstoppableboy99@gmail.com');
	});

	it('the price rolls to each tier\'s price, and reads as dollars to assistive tech', async () => {
		mockApi();
		const screen = await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Top Suvy/ }).click();
		await expect.element(page.getByRole('img', { name: '$20 US dollars' })).toBeInTheDocument();
		const digits = screen.container.querySelector('.sp-amount-digits');
		expect(digits?.getAttribute('aria-hidden')).toBe('true');
		expect(digits?.textContent).toBe('20');
		expect(digits?.querySelector('.sp-digit')?.className).toContain('is-up');
	});
});
