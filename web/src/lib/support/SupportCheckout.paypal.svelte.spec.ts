import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

vi.mock('@/features/multichat/previewIdentityClient', () => ({
	cachedPreviewIdentity: () => null,
	acquirePreviewIdentity: () => ({ promise: new Promise(() => {}), enrichment: Promise.resolve(), release: () => {} })
}));
vi.mock('@/features/multichat/previewBttvPro', () => ({ loadPreviewBttvProBadges: async () => new Map() }));
vi.mock('@/lib/communityBadges', () => ({ resolveTwitchJilChatBadges: async () => [] }));

/* A stand-in for PayPal's SDK: one real button per funding source, running
   the same callbacks PayPal's would. */
const sdk = vi.hoisted(() => ({
	blocked: false,
	approve: true,
	disabled: false,
	loads: [] as { clientId: string; cards: boolean }[],
	buttons: [] as { fundingSource?: string; style?: Record<string, unknown> }[]
}));
vi.mock('./paypalSdk.ts', async (original) => ({
	...(await original<typeof import('./paypalSdk.ts')>()),
	loadPayPalSdk: async (clientId: string, options: { cards: boolean }) => {
		sdk.loads.push({ clientId, cards: options.cards });
		if (sdk.blocked) throw new Error('blocked');
		return {
			Buttons(options: import('./paypalSdk.ts').PayPalButtonsOptions) {
				sdk.buttons.push({ fundingSource: options.fundingSource, style: options.style });
				const disabled = { value: false };
				const actions = {
					enable: () => (sdk.disabled = disabled.value = false),
					disable: () => (sdk.disabled = disabled.value = true),
					reject: () => 'rejected',
					resolve: () => 'resolved'
				};
				const label =
					options.fundingSource === 'card'
						? 'Debit or Credit Card'
						: options.style?.label === 'buynow'
							? 'PayPal Buy Now'
							: 'PayPal';
				return {
					isEligible: () => true,
					async render(container: HTMLElement) {
						const button = document.createElement('button');
						button.type = 'button';
						button.textContent = label;
						button.onclick = async () => {
							if (options.onClick?.({ fundingSource: options.fundingSource }, actions) === 'rejected') return;
							try {
								const orderID = await options.createOrder();
								if (sdk.approve) await options.onApprove({ orderID });
								else options.onCancel?.({ orderID });
							} catch (error) {
								options.onError?.(error);
							}
						};
						container.append(button);
						options.onInit?.({}, actions);
					},
					close() {}
				};
			}
		};
	}
}));

import SupportCheckout from './SupportCheckout.svelte';

const BUYER = { id: '999', login: 'buyer', displayName: 'Buyer' };
const ORDER = '5O190127TN364715T';
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const posts: { url: string; body: unknown }[] = [];
let checkoutResponse: () => Response;
let statusBody: Record<string, unknown>;
let stripeResponse: () => Response;
let meBody: Record<string, unknown>;
let captureBody: Record<string, unknown>;

function mockApi() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body ?? 'null')) });
			if (url === '/api/auth/me') return json(meBody);
			if (url === '/api/support/status') return json(statusBody);
			if (url === '/api/support/stripe-checkout') return stripeResponse();
			if (url === '/api/support/stripe-confirm') return json({ status: 'completed', recipient: { displayName: 'Buyer' } });
			if (url.startsWith('/api/twitch/support-user?login=')) {
				const login = decodeURIComponent(url.split('=')[1]);
				return login === 'friend_01' ? json({ id: '777', login, displayName: 'Friend_01' }) : json({}, 404);
			}
			if (url === '/api/twitch/gxufy-badges') return json([{ id: 'supporter', userIds: [] }]);
			if (url === '/api/support/checkout') return checkoutResponse();
			if (url === '/api/support/capture') return json(captureBody);
			return json({}, 404);
		})
	);
}

beforeEach(() => {
	posts.length = 0;
	sdk.blocked = false;
	sdk.approve = true;
	sdk.disabled = false;
	sdk.loads.length = 0;
	sdk.buttons.length = 0;
	checkoutResponse = () => json({ approveUrl: '', orderId: ORDER });
	statusBody = { checkoutReady: true, signInReady: true, paypal: { clientId: 'sandbox-client-id', env: 'sandbox' } };
	stripeResponse = () => json({ url: 'https://evil.example/pay' });
	meBody = { signInReady: true, user: BUYER, badges: [] };
	captureBody = { status: 'completed', recipient: { displayName: 'Buyer' } };
	mockApi();
	window.history.replaceState(window.history.state, '', window.location.pathname);
});

afterEach(() => vi.unstubAllGlobals());

describe('PayPal buttons on the support page', () => {
	it('loads PayPal with the public client ID: gold PayPal Buy Now and its card button, nothing else', async () => {
		await render(SupportCheckout);
		await expect.element(page.getByRole('button', { name: 'PayPal Buy Now' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Debit or Credit Card' })).toBeInTheDocument();
		await expect.element(page.getByText(/Pay \$5 with/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /^Continue with/ })).not.toBeInTheDocument();
		expect(page.getByRole('button', { name: /Venmo|Pay Later/ }).elements()).toEqual([]);
		expect(sdk.loads).toEqual([{ clientId: 'sandbox-client-id', cards: true }]);
		expect(sdk.buttons.map((button) => button.fundingSource)).toEqual(['paypal', 'card']);
		expect(sdk.buttons[0].style).toMatchObject({ color: 'gold', label: 'buynow' });
	});

	it('Custom with PayPal: the typed amount; one that reaches no new badge is thanked as counting toward the next', async () => {
		meBody = {
			signInReady: true,
			user: BUYER,
			badges: [],
			standing: { tier: 'suvy', founder: false, prices: { supporter: null, suvy: null, 'top-suvy': 1000 } }
		};
		captureBody = { status: 'completed', recipient: { displayName: 'Buyer', login: 'buyer' }, tier: 'suvy' };
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Custom/ }).click();
		await page.getByRole('textbox', { name: /Amount in US dollars/ }).fill('6');
		await expect.element(page.getByText(/Pay \$6 with/)).toBeInTheDocument();
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		await expect.element(page.getByText('Thank you for the extra support! It counts toward your Top Suvy badge.')).toBeInTheDocument();
		expect(posts).toEqual([
			{ url: '/api/support/checkout', body: { amountCents: 600, forSelf: true, fundingSource: 'paypal' } },
			{ url: '/api/support/capture', body: { orderId: ORDER } }
		]);
	});

	it('Custom with PayPal that reaches a new badge: thanked for that badge', async () => {
		captureBody = { status: 'completed', recipient: { displayName: 'Buyer', login: 'buyer' }, tier: 'suvy' };
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Custom/ }).click();
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		await expect.element(page.getByText(/Your Suvy badge is on/)).toBeInTheDocument();
		expect(posts[0]).toEqual({ url: '/api/support/checkout', body: { amountCents: 1500, forSelf: true, fundingSource: 'paypal' } });
	});

	it('PayPal for you: the server makes the order, PayPal approves, the server confirms', async () => {
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Suvy/ }).click();
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		await expect.element(page.getByText('Thank you!')).toBeInTheDocument();
		expect(posts).toEqual([
			{ url: '/api/support/checkout', body: { tier: 'suvy', forSelf: true, fundingSource: 'paypal' } },
			{ url: '/api/support/capture', body: { orderId: ORDER } }
		]);
	});

	it('a gift by card goes to the verified name', async () => {
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await page.getByRole('textbox', { name: 'Twitch username' }).fill('friend_01');
		await expect.element(page.getByText('Verified as Friend_01.')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Debit or Credit Card' }).click();
		await expect.element(page.getByText('Thank you!')).toBeInTheDocument();
		expect(posts[0]).toEqual({
			url: '/api/support/checkout',
			body: { tier: 'supporter', login: 'friend_01', fundingSource: 'card' }
		});
	});

	it('the buttons do nothing until a gift name is verified', async () => {
		await render(SupportCheckout);
		await page.getByRole('radio', { name: 'As a gift' }).click();
		await page.getByRole('textbox', { name: 'Twitch username' }).fill('nobody_here');
		await expect.element(page.getByText('No Twitch account found.')).toBeInTheDocument();
		expect(sdk.disabled).toBe(true);
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		expect(posts).toEqual([]);
	});

	it('closing PayPal’s window charges nothing', async () => {
		sdk.approve = false;
		await render(SupportCheckout);
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		await expect.element(page.getByText('Payment cancelled. Nothing was charged.')).toBeInTheDocument();
		expect(posts.map((post) => post.url)).toEqual(['/api/support/checkout']);
	});

	it('shows the server’s reason when it refuses to make the order', async () => {
		checkoutResponse = () => json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
		await render(SupportCheckout);
		await page.getByRole('button', { name: 'PayPal Buy Now' }).click();
		await expect.element(page.getByText('Too many attempts. Try again in a few minutes.')).toBeInTheDocument();
		expect(posts.map((post) => post.url)).toEqual(['/api/support/checkout']);
	});

	it('falls back to continuing on PayPal’s page when the buttons are blocked', async () => {
		sdk.blocked = true;
		await render(SupportCheckout);
		await expect.element(page.getByText(/buttons couldn’t load/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Continue with $5' })).toBeInTheDocument();
	});

	it('with Stripe set up: the white card / Apple Pay / Google Pay button, then only PayPal Buy Now', async () => {
		statusBody = { ...statusBody, stripe: true };
		await render(SupportCheckout);
		const card = page.getByRole('button', { name: 'Card, Apple Pay or Google Pay' });
		const paypal = page.getByRole('button', { name: 'PayPal Buy Now' });
		await expect.element(card).toBeInTheDocument();
		await expect.element(paypal).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Debit or Credit Card' })).not.toBeInTheDocument();
		expect(sdk.loads).toEqual([{ clientId: 'sandbox-client-id', cards: false }]);
		expect(sdk.buttons.map((button) => button.fundingSource)).toEqual(['paypal']);
		/* Card first, like Chatlee, and no "or" line between them. */
		expect(card.element().compareDocumentPosition(paypal.element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(page.getByText(/^or$/i).elements()).toEqual([]);
	});

	it('with Stripe set up and PayPal’s buttons blocked: the way to PayPal says so', async () => {
		statusBody = { ...statusBody, stripe: true };
		sdk.blocked = true;
		await render(SupportCheckout);
		await expect.element(page.getByRole('button', { name: 'Continue to PayPal' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Card, Apple Pay or Google Pay' })).toBeInTheDocument();
	});

	it('the Stripe button asks our server, and only ever leaves for Stripe’s own page', async () => {
		statusBody = { ...statusBody, stripe: true };
		await render(SupportCheckout);
		await page.getByRole('radio', { name: /^Top Suvy/ }).click();
		await page.getByRole('button', { name: 'Card, Apple Pay or Google Pay' }).click();
		await expect.element(page.getByText('Card checkout is not available right now.')).toBeInTheDocument();
		expect(posts).toEqual([{ url: '/api/support/stripe-checkout', body: { tier: 'top-suvy', forSelf: true } }]);
	});

	it('only Stripe set up: no PayPal buttons and no PayPal redirect', async () => {
		statusBody = { checkoutReady: false, signInReady: true, stripe: true };
		await render(SupportCheckout);
		await expect.element(page.getByRole('button', { name: 'Card, Apple Pay or Google Pay' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /^Continue with/ })).not.toBeInTheDocument();
		expect(sdk.loads).toEqual([]);
	});

	it('back from Stripe, paid: our server checks with Stripe before saying thank you', async () => {
		window.history.replaceState(window.history.state, '', `${window.location.pathname}?stripe=return&session_id=cs_test_a1B2c3D4e5F6g7H8i9J0`);
		statusBody = { ...statusBody, stripe: true };
		await render(SupportCheckout);
		await expect.element(page.getByText('Thank you!')).toBeInTheDocument();
		expect(posts).toEqual([{ url: '/api/support/stripe-confirm', body: { sessionId: 'cs_test_a1B2c3D4e5F6g7H8i9J0' } }]);
		expect(window.location.search).toBe('');
	});

	it('back from Stripe, cancelled or with a bad session id: nothing is asked or charged', async () => {
		window.history.replaceState(window.history.state, '', `${window.location.pathname}?stripe=cancel`);
		await render(SupportCheckout);
		await expect.element(page.getByText('Payment cancelled. Nothing was charged.')).toBeInTheDocument();
		expect(posts).toEqual([]);
	});
});
