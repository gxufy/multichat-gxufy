import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once, serve, send, type Answer, type Call, type Loader } from './routeServer.ts';

/*
 * The supporter payments: starting a PayPal or card checkout, confirming it,
 * PayPal's and Stripe's webhooks, and the support status. PayPal, Stripe,
 * Twitch's account lookup and Discord are a stand-in that keeps its own
 * orders, so a whole purchase runs as a sequence from an empty database: it
 * must grant the badge once and send one purchase notice. The snapshots are
 * what the Next.js app answered (this app was checked against it, request for
 * request, before it was retired). No real service is called; the keys are
 * made up.
 */

const ROUTES = {
	checkout: { path: '/api/support/checkout', load: () => import('@/api/support/checkout') },
	capture: { path: '/api/support/capture', load: () => import('@/api/support/capture') },
	paypalWebhook: { path: '/api/support/paypal-webhook', load: () => import('@/api/support/paypal-webhook') },
	status: { path: '/api/support/status', load: () => import('@/api/support/status') },
	stripeCheckout: { path: '/api/support/stripe-checkout', load: () => import('@/api/support/stripe-checkout') },
	stripeConfirm: { path: '/api/support/stripe-confirm', load: () => import('@/api/support/stripe-confirm') },
	stripeWebhook: { path: '/api/support/stripe-webhook', load: () => import('@/api/support/stripe-webhook') },
	me: { path: '/api/auth/me', load: () => import('@/api/auth/me') }
} satisfies Record<string, { path: string; load: Loader }>;
type RouteName = keyof typeof ROUTES;

const storeDir = mkdtempSync(path.join(tmpdir(), 'fc-payments-'));
let storeCount = 0;
const STRIPE_WEBHOOK_SECRET = 'whsec_parity0123456789abcdef';
const ENV = {
	GXUFY_SUPPORT_PAGE_ENABLED: '1',
	TWITCH_CLIENT_ID: 'parity-client-id',
	TWITCH_CLIENT_SECRET: 'parity-client-secret',
	FLOSSCHAT_SESSION_SECRET: 'parity-session-secret-0123456789abcdef',
	GXUFY_SUPPORTER_STORE_BACKUPS: 'off',
	PAYPAL_ENV: 'sandbox',
	PAYPAL_CLIENT_ID: 'parity-paypal-client-id',
	PAYPAL_CLIENT_SECRET: 'parity-paypal-secret',
	PAYPAL_WEBHOOK_ID: 'WH-PARITY-0001',
	STRIPE_ENV: 'sandbox',
	/* A made-up sandbox key, written in parts so it never reads as a real one. */
	STRIPE_SECRET_KEY: ['sk', 'test', 'parity0123456789abcdef'].join('_'),
	STRIPE_WEBHOOK_SECRET,
	GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789/parity-purchase-notice-hook'
};
const NOW = Date.parse('2026-11-26T04:00:00Z');
const SITE = 'https://flosschat.app';
const PAYPAL = 'https://api-m.sandbox.paypal.com';
const STRIPE = 'https://api.stripe.com/v1';
const BUYER = { id: '12345', login: 'someviewer', displayName: 'SomeViewer' };
const FRIEND = { id: '67890', login: 'afriend', displayName: 'AFriend' };

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/* ---- The stand-in for PayPal, Stripe, Twitch and Discord. ---------------- */

type PayPalOrder = { id: string; amount: string; customId: string; referenceId: string; approved: boolean; captured: string | null; captureStatus: string };
type StripeSession = { id: string; amount: number; reference: string; metadata: Record<string, string>; paid: boolean };

function standIn() {
	const state = {
		orders: new Map<string, PayPalOrder>(),
		sessions: new Map<string, StripeSession>(),
		notices: 0,
		/* What a test can change: PayPal reports a pending capture, or another amount. */
		pending: false,
		reportedAmount: null as string | null
	};
	const orderBody = (order: PayPalOrder) => ({
		id: order.id,
		status: order.captured ? 'COMPLETED' : order.approved ? 'APPROVED' : 'PAYER_ACTION_REQUIRED',
		purchase_units: [
			{
				reference_id: order.referenceId,
				custom_id: order.customId,
				payee: { merchant_id: 'PARITYMERCHANT' },
				...(order.captured
					? { payments: { captures: [{ id: order.captured, status: order.captureStatus, custom_id: order.customId, amount: { currency_code: 'USD', value: state.reportedAmount ?? order.amount } }] } }
					: {})
			}
		],
		links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}` }]
	});
	const sessionBody = (session: StripeSession) => ({
		id: session.id,
		object: 'checkout.session',
		status: session.paid ? 'complete' : 'open',
		payment_status: session.paid ? 'paid' : 'unpaid',
		amount_subtotal: session.amount,
		amount_total: session.amount,
		currency: 'usd',
		client_reference_id: session.reference,
		metadata: session.metadata,
		payment_intent: session.paid ? `pi_parity${session.id.slice(-10)}` : null,
		livemode: false,
		url: `https://checkout.stripe.com/c/pay/${session.id}`
	});
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? init.body : '';
		if (url === `${PAYPAL}/v1/oauth2/token`) return json({ access_token: 'parity-paypal-token', expires_in: 32400 });
		if (url === `${PAYPAL}/v2/checkout/orders` && method === 'POST') {
			const request = JSON.parse(body) as { purchase_units: Array<{ reference_id: string; custom_id: string; amount: { value: string } }> };
			const unit = request.purchase_units[0]!;
			const id = `PARITYORDER${String(state.orders.size + 1).padStart(6, '0')}`;
			state.orders.set(id, { id, amount: unit.amount.value, customId: unit.custom_id, referenceId: unit.reference_id, approved: false, captured: null, captureStatus: '' });
			return json(orderBody(state.orders.get(id)!), 201);
		}
		const capture = /^https:\/\/api-m\.sandbox\.paypal\.com\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/.exec(url);
		if (capture) {
			const order = state.orders.get(capture[1]!);
			if (!order) return json({ name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] }, 404);
			if (order.captured) return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, 422);
			if (!order.approved) return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] }, 422);
			order.captured = `PARITYCAPTURE${order.id.slice(-6)}`;
			order.captureStatus = state.pending ? 'PENDING' : 'COMPLETED';
			return json(orderBody(order), 201);
		}
		const lookup = /^https:\/\/api-m\.sandbox\.paypal\.com\/v2\/checkout\/orders\/([A-Z0-9]+)$/.exec(url);
		if (lookup) {
			const order = state.orders.get(lookup[1]!);
			return order ? json(orderBody(order)) : json({ name: 'RESOURCE_NOT_FOUND' }, 404);
		}
		if (url === `${PAYPAL}/v1/notifications/verify-webhook-signature`) {
			const request = JSON.parse(body) as { transmission_sig: string; webhook_id: string };
			const good = request.transmission_sig === 'parity-good-signature' && request.webhook_id === ENV.PAYPAL_WEBHOOK_ID;
			return json({ verification_status: good ? 'SUCCESS' : 'FAILURE' });
		}
		if (url === `${STRIPE}/checkout/sessions` && method === 'POST') {
			const form = new URLSearchParams(body);
			const id = `cs_test_parity${String(state.sessions.size + 1).padStart(10, '0')}`;
			state.sessions.set(id, {
				id,
				amount: Number(form.get('line_items[0][price_data][unit_amount]')),
				reference: form.get('client_reference_id') ?? '',
				metadata: { reference: form.get('metadata[reference]') ?? '', recipient_id: form.get('metadata[recipient_id]') ?? '', kind: form.get('metadata[kind]') ?? '' },
				paid: false
			});
			return json(sessionBody(state.sessions.get(id)!));
		}
		const session = /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9]+)$/.exec(url);
		if (session) {
			const found = state.sessions.get(session[1]!);
			return found ? json(sessionBody(found)) : json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
		}
		if (url === 'https://gql.twitch.tv/gql') {
			const login = (JSON.parse(body) as { variables?: { login?: string } }).variables?.login;
			const user = [BUYER, FRIEND].find((candidate) => candidate.login === login);
			return json({ data: { user: user ? { id: user.id, login: user.login, displayName: user.displayName, profileImageURL: null } : null } });
		}
		if (url === ENV.GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL) {
			state.notices += 1;
			return new Response(null, { status: 204 });
		}
		throw new TypeError(`fetch failed: ${url}`);
	});
	return {
		state,
		fetcher,
		approve: (id: string) => void (state.orders.get(id)!.approved = true),
		pay: (id: string) => void (state.sessions.get(id)!.paid = true)
	};
}
type StandIn = ReturnType<typeof standIn>;

/* ---- Requests. ----------------------------------------------------------- */

async function sessionCookie(user: { id: string; login: string; displayName: string }): Promise<string> {
	const { writeSession } = await import('@/lib/server/session');
	let list: string[] = [];
	const res = { getHeader: () => list, setHeader: (_name: string, value: string[]) => void (list = value) };
	expect(writeSession(res as never, user, process.env, NOW)).toBe(true);
	return list[0]!.split(';')[0]!;
}
const post = (body: unknown, headers: Record<string, string> = {}): Omit<Call, 'path'> => ({
	method: 'POST',
	headers: { Origin: SITE, 'Content-Type': 'application/json', ...headers },
	body: typeof body === 'string' ? body : JSON.stringify(body)
});
const asBuyer = async (body: unknown) => post(body, { Cookie: await sessionCookie(BUYER) });

/* A PayPal webhook as PayPal sends it (its signature is checked with the stand-in). */
function paypalWebhook(event: Record<string, unknown>, signature = 'parity-good-signature'): Omit<Call, 'path'> {
	return {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'paypal-auth-algo': 'SHA256withRSA',
			'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-parity',
			'paypal-transmission-id': 'parity-transmission-1',
			'paypal-transmission-sig': signature,
			'paypal-transmission-time': new Date(NOW).toISOString()
		},
		body: JSON.stringify({ id: 'WH-EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', ...event })
	};
}
const captureCompleted = (orderId: string) =>
	paypalWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: `PARITYCAPTURE${orderId.slice(-6)}`, status: 'COMPLETED', supplementary_data: { related_ids: { order_id: orderId } } } });
const captureRefunded = (orderId: string) =>
	paypalWebhook({
		event_type: 'PAYMENT.CAPTURE.REFUNDED',
		resource: { id: 'PARITYREFUND000001', status: 'COMPLETED', links: [{ rel: 'up', href: `${PAYPAL}/v2/payments/captures/PARITYCAPTURE${orderId.slice(-6)}` }] }
	});

/* A Stripe webhook, signed over the exact bytes sent. */
function stripeWebhook(event: Record<string, unknown>, options: { secret?: string; raw?: string } = {}): Omit<Call, 'path'> {
	const raw = options.raw ?? JSON.stringify({ id: 'evt_parity', object: 'event', livemode: false, ...event });
	const t = Math.floor(NOW / 1000);
	const v1 = createHmac('sha256', options.secret ?? STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`, 'utf8').digest('hex');
	return { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': `t=${t},v1=${v1}` }, body: raw };
}

type Step =
	| { route: RouteName; call: Omit<Call, 'path'> | (() => Promise<Omit<Call, 'path'>> | Omit<Call, 'path'>) }
	| { act: (standIn: StandIn) => void };

/* The steps in order, from an empty database and a fresh stand-in. */
async function run(steps: Step[]): Promise<{ web: Answer[]; fake: StandIn }> {
	const web: Answer[] = [];
	vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
	const fake = standIn();
	vi.stubGlobal('fetch', fake.fetcher);
	for (const step of steps) {
		if ('act' in step) {
			step.act(fake);
			continue;
		}
		const call = typeof step.call === 'function' ? await step.call() : step.call;
		web.push(await once(ROUTES[step.route].load, { ...call, path: ROUTES[step.route].path }));
	}
	/* Discord notices go out in the background. */
	await new Promise((resolve) => setTimeout(resolve, 20));
	return { web, fake };
}
const statuses = (answers: Answer[]) => answers.map((answer) => answer.status);
const bodyOf = (answer: Answer) => JSON.parse(answer.body) as Record<string, unknown>;
const ORDER_1 = 'PARITYORDER000001';
const SESSION_1 = 'cs_test_parity0000000001';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

afterAll(async () => {
	const { __closeSupporterStoresForTests } = await import('@/lib/server/supporterStore');
	__closeSupporterStoresForTests();
	rmSync(storeDir, { recursive: true, force: true });
});

/* ---- PayPal. ------------------------------------------------------------- */

describe('a PayPal purchase', () => {
	it('buys a badge for yourself: checkout, approve, capture, a repeat', async () => {
		const { web, fake } = await run([
			{ route: 'checkout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ act: (fake) => fake.approve(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'me', call: async () => ({ headers: { Cookie: await sessionCookie(BUYER) } }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 200, 200, 200]);
		expect(bodyOf(web[0]!)).toEqual({ approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_1}`, orderId: ORDER_1 });
		expect(bodyOf(web[1]!)).toEqual({ status: 'completed', recipient: { login: BUYER.login, displayName: BUYER.displayName }, tier: 'supporter' });
		expect((bodyOf(web[3]!).badges as Array<{ id: string }>).map((badge) => badge.id)).toContain('supporter');
		/* The order PayPal was asked for: exactly $5, for this account. */
		const order = fake.state.orders.get(ORDER_1)!;
		expect(order.amount).toBe('5.00');
		expect(order.customId).toBe(`twitch:${BUYER.id}`);
		expect(fake.state.notices).toBe(1);
	});

	it('gifts a higher tier, priced by the server', async () => {
		const { web, fake } = await run([
			{ route: 'checkout', call: () => asBuyer({ login: 'AFriend', tier: 'suvy', amountCents: 1 }) },
			{ act: (fake) => fake.approve(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 200]);
		expect(bodyOf(web[1]!)).toMatchObject({ status: 'completed', recipient: { login: FRIEND.login }, tier: 'suvy' });
		expect(fake.state.orders.get(ORDER_1)!.amount).toBe('10.00');
	});

	it('takes plain support with no badge', async () => {
		const { web } = await run([
			{ route: 'checkout', call: () => asBuyer({ amountCents: 700 }) },
			{ act: (fake) => fake.approve(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(bodyOf(web[1]!)).toEqual({ status: 'completed', recipient: null, tier: null });
	});

	it('grants a payment PayPal finishes later through the webhook, once', async () => {
		const { web, fake } = await run([
			{ act: (fake) => void (fake.state.pending = true) },
			{ route: 'checkout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ act: (fake) => fake.approve(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ act: (fake) => void (fake.state.orders.get(ORDER_1)!.captureStatus = 'COMPLETED') },
			{ route: 'paypalWebhook', call: captureCompleted(ORDER_1) },
			{ route: 'paypalWebhook', call: captureCompleted(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 202, 200, 200, 200]);
		expect(bodyOf(web[1]!)).toMatchObject({ status: 'pending' });
		expect(bodyOf(web[4]!)).toMatchObject({ status: 'completed' });
		expect(fake.state.notices).toBe(1);
	});

	it('takes the badge back on a refund', async () => {
		const { web } = await run([
			{ route: 'checkout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ act: (fake) => fake.approve(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'paypalWebhook', call: captureRefunded(ORDER_1) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'me', call: async () => ({ headers: { Cookie: await sessionCookie(BUYER) } }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 200, 200, 409, 200]);
		expect((bodyOf(web[4]!).badges as unknown[]).length).toBe(0);
	});

	it('grants nothing when PayPal reports another amount', async () => {
		const { web, fake } = await run([
			{ route: 'checkout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ act: (fake) => { fake.approve(ORDER_1); fake.state.reportedAmount = '0.50'; } },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'me', call: async () => ({ headers: { Cookie: await sessionCookie(BUYER) } }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 409, 200]);
		expect((bodyOf(web[2]!).badges as unknown[]).length).toBe(0);
		expect(fake.state.notices).toBe(0);
	});

	it('answers a capture before approval', async () => {
		const { web } = await run([
			{ route: 'checkout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 502]);
	});

	const refused: Array<[string, RouteName, () => Promise<Omit<Call, 'path'>> | Omit<Call, 'path'>, number]> = [
		['a checkout signed out', 'checkout', () => post({ forSelf: true }), 401],
		['a checkout for an unknown tier', 'checkout', () => asBuyer({ forSelf: true, tier: 'gold' }), 400],
		['a checkout under $5', 'checkout', () => asBuyer({ amountCents: 100 }), 400],
		['a checkout over $500', 'checkout', () => asBuyer({ amountCents: 50_001 }), 400],
		['a gift to an unknown account', 'checkout', () => asBuyer({ login: 'nobodyhere', tier: 'supporter' }), 404],
		['a gift to a name that is not one', 'checkout', () => asBuyer({ login: 'bad name!' }), 400],
		['a checkout with an unknown button', 'checkout', () => asBuyer({ forSelf: true, fundingSource: 'crypto' }), 400],
		['a checkout as a GET', 'checkout', () => ({}), 405],
		['a capture of an id that is not one', 'capture', () => post({ orderId: 'nope' }), 400],
		['a capture of an order this server never made', 'capture', () => post({ orderId: 'SOMEOTHERORDER01' }), 404],
		['a capture as a GET', 'capture', () => ({}), 405],
		['a webhook with a bad signature', 'paypalWebhook', () => paypalWebhook({}, 'forged'), 400],
		['a webhook without PayPal headers', 'paypalWebhook', () => post({ event_type: 'PAYMENT.CAPTURE.REFUNDED' }), 400],
		['a webhook as a GET', 'paypalWebhook', () => ({}), 405]
	];
	for (const [label, route, call, status] of refused) {
		it(`refuses ${label}`, async () => {
			const { web } = await run([{ route, call }]);
			expect(web).toMatchSnapshot();
			expect(web[0]!.status).toBe(status);
		});
	}

	it('limits checkouts per visitor (8 in 10 minutes)', async () => {
		const call = await asBuyer({ amountCents: 500 });
		vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
		vi.stubGlobal('fetch', standIn().fetcher);
		const server = await serve(ROUTES.checkout.load);
		try {
			const codes: number[] = [];
			for (let i = 0; i < 9; i++) codes.push((await send(server, { ...call, path: ROUTES.checkout.path })).status);
			expect(codes).toEqual([...Array(8).fill(200), 429]);
		} finally {
			await server.close();
		}
	});
});

/* ---- Stripe. ------------------------------------------------------------- */

describe('a card purchase (Stripe)', () => {
	it('buys a badge: checkout, pay, confirm, a repeat, then the webhook', async () => {
		const { web, fake } = await run([
			{ route: 'stripeCheckout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) },
			{ act: (fake) => fake.pay(SESSION_1) },
			{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) },
			{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) },
			{ route: 'stripeWebhook', call: stripeWebhook({ type: 'checkout.session.completed', data: { object: { id: SESSION_1 } } }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 409, 200, 200, 200]);
		expect(bodyOf(web[0]!)).toEqual({ url: `https://checkout.stripe.com/c/pay/${SESSION_1}` });
		expect(bodyOf(web[2]!)).toEqual({ status: 'completed', recipient: { login: BUYER.login, displayName: BUYER.displayName }, tier: 'supporter' });
		expect(fake.state.sessions.get(SESSION_1)!.amount).toBe(500);
		expect(fake.state.notices).toBe(1);
	});

	it('grants a buyer who never came back, through the webhook', async () => {
		const { web, fake } = await run([
			{ route: 'stripeCheckout', call: () => asBuyer({ login: 'afriend', tier: 'supporter' }) },
			{ act: (fake) => fake.pay(SESSION_1) },
			{ route: 'stripeWebhook', call: stripeWebhook({ type: 'checkout.session.completed', data: { object: { id: SESSION_1 } } }) },
			{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 200, 200]);
		expect(bodyOf(web[2]!)).toMatchObject({ status: 'completed', recipient: { login: FRIEND.login } });
		expect(fake.state.notices).toBe(1);
	});

	it('takes the badge back on a refund or dispute', async () => {
		for (const type of ['charge.refunded', 'charge.dispute.created']) {
			const { web } = await run([
				{ route: 'stripeCheckout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
				{ act: (fake) => fake.pay(SESSION_1) },
				{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) },
				{ route: 'stripeWebhook', call: stripeWebhook({ type, data: { object: { id: 'ch_parity', payment_intent: `pi_parity${SESSION_1.slice(-10)}` } } }) },
				{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) }
			]);
			expect(web).toMatchSnapshot();
			expect(statuses(web)).toEqual([200, 200, 200, 409]);
		}
	});

	it('checks the signature over the exact bytes sent (spacing, non-ASCII text)', async () => {
		const raw = `{\n  "id": "evt_parity",  "object": "event", "livemode": false,\n  "type": "checkout.session.completed", "note": "Gxüfy ✓ 💜",\n  "data": { "object": { "id": "${SESSION_1}" } }\n}`;
		const { web } = await run([
			{ route: 'stripeCheckout', call: () => asBuyer({ forSelf: true, tier: 'supporter' }) },
			{ act: (fake) => fake.pay(SESSION_1) },
			{ route: 'stripeWebhook', call: stripeWebhook({}, { raw }) },
			{ route: 'stripeConfirm', call: post({ sessionId: SESSION_1 }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([200, 200, 200]);
	});

	const refused: Array<[string, RouteName, () => Promise<Omit<Call, 'path'>> | Omit<Call, 'path'>, number]> = [
		['a webhook signed with another secret', 'stripeWebhook', () => stripeWebhook({ type: 'charge.refunded' }, { secret: 'whsec_someoneelse0123456789' }), 400],
		['a webhook with no signature', 'stripeWebhook', () => post({ type: 'charge.refunded' }), 400],
		['a signed webhook that is not JSON', 'stripeWebhook', () => stripeWebhook({}, { raw: 'not json' }), 400],
		['a live-mode event on a sandbox setup', 'stripeWebhook', () => stripeWebhook({ type: 'charge.refunded', livemode: true }), 200],
		['a webhook as a GET', 'stripeWebhook', () => ({}), 405],
		['a confirm of an id that is not one', 'stripeConfirm', () => post({ sessionId: 'nope' }), 400],
		['a confirm of a session this server never made', 'stripeConfirm', () => post({ sessionId: 'cs_test_someoneelse0001' }), 404],
		['a card checkout signed out', 'stripeCheckout', () => post({ forSelf: true }), 401],
		['a card checkout with no badge (Managed Payments)', 'stripeCheckout', () => asBuyer({ amountCents: 700 }), 400]
	];
	for (const [label, route, call, status] of refused) {
		it(`refuses ${label}`, async () => {
			const { web } = await run([{ route, call }]);
			expect(web).toMatchSnapshot();
			expect(web[0]!.status).toBe(status);
		});
	}
});

/* ---- The support status and the switches. -------------------------------- */

describe('/api/support/status and checkout switched off', () => {
	it('tells the page what is set up', async () => {
		const { web } = await run([{ route: 'status', call: {} }]);
		expect(web).toMatchSnapshot();
		expect(bodyOf(web[0]!)).toEqual({
			checkoutReady: true,
			signInReady: true,
			paypal: { clientId: ENV.PAYPAL_CLIENT_ID, env: 'sandbox' },
			stripe: true,
			founderSlotsLeft: expect.any(Number)
		});
		expect(web[0]!.body).not.toContain(ENV.PAYPAL_CLIENT_SECRET);
		expect(web[0]!.body).not.toContain(ENV.STRIPE_SECRET_KEY);
	});

	it('keeps checkout off without the PayPal keys', async () => {
		vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
		const { web } = await run([
			{ route: 'status', call: {} },
			{ route: 'checkout', call: () => asBuyer({ forSelf: true }) },
			{ route: 'capture', call: post({ orderId: ORDER_1 }) },
			{ route: 'paypalWebhook', call: captureCompleted(ORDER_1) }
		]);
		expect(web).toMatchSnapshot();
		expect(bodyOf(web[0]!)).toMatchObject({ checkoutReady: false });
		expect(statuses(web).slice(1)).toEqual([404, 404, 404]);
	});

	it('refuses live PayPal without its release switch', async () => {
		vi.stubEnv('PAYPAL_ENV', 'live');
		const { web } = await run([{ route: 'checkout', call: () => asBuyer({ forSelf: true }) }]);
		expect(web).toMatchSnapshot();
		expect(web[0]!.status).toBe(404);
	});

	it('refuses a sandbox Stripe key on a live setup', async () => {
		vi.stubEnv('STRIPE_ENV', 'live');
		vi.stubEnv('GXUFY_STRIPE_LIVE_APPROVED', '1');
		const { web } = await run([
			{ route: 'stripeCheckout', call: () => asBuyer({ forSelf: true }) },
			{ route: 'stripeWebhook', call: stripeWebhook({ type: 'charge.refunded' }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([404, 404]);
	});

	it('is all off (404) with the support page switched off', async () => {
		vi.stubEnv('GXUFY_SUPPORT_PAGE_ENABLED', '0');
		const { web } = await run([
			{ route: 'status', call: {} },
			{ route: 'checkout', call: () => asBuyer({ forSelf: true }) },
			{ route: 'stripeCheckout', call: () => asBuyer({ forSelf: true }) }
		]);
		expect(web).toMatchSnapshot();
		expect(statuses(web)).toEqual([404, 404, 404]);
	});
});
