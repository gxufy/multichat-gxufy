import { createHmac } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));

import stripeCheckoutHandler, { __resetStripeCheckoutLimitForTests } from '@/api/support/stripe-checkout';
import stripeConfirmHandler from '@/api/support/stripe-confirm';
import stripeWebhookHandler from '@/api/support/stripe-webhook';
import statusHandler from '@/api/support/status';
import { stripeConfig, stripeForm, verifyStripeSignature } from '@/lib/server/stripe';
import { SupporterStore, __closeSupporterStoresForTests } from '@/lib/server/supporterStore';
import { __resetSupportTwitchUserResourcesForTests } from '@/api/twitch/support-user';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

const SESSION_ID = 'cs_test_a1B2c3D4e5F6g7H8i9J0';
const INTENT_ID = 'pi_3Q1w2E3r4T5y6U7i';
const WEBHOOK_SECRET = 'whsec_testsecret1234567890';
let dir = '';
let storePath = '';
let created: URLSearchParams | null = null;
let createdHeaders: Record<string, string> = {};
let sessionOverride: ((created: URLSearchParams) => Record<string, unknown>) | null = null;
let lookups = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function paidSession(form: URLSearchParams): Record<string, unknown> {
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    amount_subtotal: Number(form.get('line_items[0][price_data][unit_amount]')),
    amount_total: Number(form.get('line_items[0][price_data][unit_amount]')),
    currency: 'usd',
    client_reference_id: form.get('client_reference_id'),
    metadata: { reference: form.get('metadata[reference]'), recipient_id: form.get('metadata[recipient_id]'), kind: form.get('metadata[kind]') },
    payment_intent: INTENT_ID,
    livemode: false,
    url: null,
  };
}

function stripeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://gql.twitch.tv/gql') {
    return Promise.resolve(json({ data: { user: { id: '123', login: 'viewer', displayName: 'Viewer', profileImageURL: null } } }));
  }
  if (url === 'https://api.stripe.com/v1/checkout/sessions' && init?.method === 'POST') {
    created = new URLSearchParams(String(init.body));
    createdHeaders = init.headers as Record<string, string>;
    return Promise.resolve(json({ id: SESSION_ID, url: `https://checkout.stripe.com/c/pay/${SESSION_ID}`, status: 'open', payment_status: 'unpaid' }));
  }
  if (url === `https://api.stripe.com/v1/checkout/sessions/${SESSION_ID}`) {
    lookups += 1;
    return Promise.resolve(json(sessionOverride ? sessionOverride(created!) : paidSession(created!)));
  }
  return Promise.reject(new Error(`unexpected ${url}`));
}

async function call(handler: (req: ApiRequest, res: ApiResponse) => unknown, body: unknown, method = 'POST') {
  let statusCode = 200;
  let payload: unknown;
  const req = { method, body, query: {}, headers: { host: 'localhost:3000' }, socket: { remoteAddress: '203.0.113.40' } } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as ApiResponse;
  await handler(req, res);
  return { statusCode, body: payload as any };
}

function signed(raw: string, secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}`;
}

async function postWebhook(event: unknown, signature?: string) {
  const raw = JSON.stringify(event);
  let statusCode = 200;
  const req = Object.assign(Readable.from([Buffer.from(raw)]), {
    method: 'POST',
    query: {},
    headers: { 'stripe-signature': signature ?? signed(raw) },
  }) as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as ApiResponse;
  await stripeWebhookHandler(req, res);
  return statusCode;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gx-stripe-'));
  storePath = path.join(dir, 'supporters.db');
  vi.stubEnv('GXUFY_SUPPORT_PAGE_ENABLED', '1');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abcdefghijklmnop');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', storePath);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('fetch', vi.fn(stripeFetch));
  created = null;
  createdHeaders = {};
  sessionOverride = null;
  lookups = 0;
  sessionUser = { id: '999', login: 'buyer', displayName: 'Buyer' };
  __resetSupportTwitchUserResourcesForTests();
  __resetStripeCheckoutLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetFixedProviderResourcesForTests();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('Stripe configuration', () => {
  it('takes sandbox keys, refuses live ones without explicit approval, and never takes junk', () => {
    expect(stripeConfig({} as any)).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'pk_test_abcdefghijklmnop' } as any)).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop' } as any)?.env).toBe('sandbox');
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'rk_test_abcdefghijklmnop' } as any)?.env).toBe('sandbox');
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop' } as any)).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', GXUFY_STRIPE_LIVE_APPROVED: '1' } as any)?.env).toBe('live');
  });

  it('never runs a sandbox key where STRIPE_ENV says live (production), or the other way round', () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop', STRIPE_ENV: 'live' } as any)).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', STRIPE_ENV: 'sandbox', GXUFY_STRIPE_LIVE_APPROVED: '1' } as any)).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop', STRIPE_ENV: 'sandbox' } as any)?.env).toBe('sandbox');
  });

  it('uses Stripe as merchant of record unless STRIPE_MANAGED_PAYMENTS is 0, with or without a product', () => {
    const key = { STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop' };
    expect(stripeConfig(key as any)?.managedPayments).toBe(true);
    expect(stripeConfig({ ...key, STRIPE_MANAGED_PAYMENTS: '1' } as any)?.managedPayments).toBe(true);
    expect(stripeConfig({ ...key, STRIPE_PRODUCT_ID: 'prod_ABC123' } as any)?.productId).toBe('prod_ABC123');
    for (const off of ['0', 'false', ' OFF ']) {
      expect(stripeConfig({ ...key, STRIPE_MANAGED_PAYMENTS: off } as any)?.managedPayments).toBe(false);
    }
  });

  it('never takes live payments without Managed Payments, so real receipts never show the account owner', () => {
    const live = { STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', GXUFY_STRIPE_LIVE_APPROVED: '1' };
    expect(stripeConfig(live as any)?.managedPayments).toBe(true);
    for (const off of ['0', 'false', 'off']) {
      expect(stripeConfig({ ...live, STRIPE_MANAGED_PAYMENTS: off } as any)).toBeNull();
    }
  });

  it('encodes nested fields the way Stripe expects', () => {
    expect(stripeForm({ a: 1, line_items: [{ price_data: { unit_amount: 500 } }], skip: undefined }).toString())
      .toBe('a=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500');
  });
});

describe('Stripe webhook signatures', () => {
  const raw = '{"id":"evt_1"}';
  const now = 1_800_000_000;

  it('accepts only the exact body, signed with the endpoint secret, within five minutes', () => {
    expect(verifyStripeSignature(raw, signed(raw, WEBHOOK_SECRET, now), WEBHOOK_SECRET, now)).toBe(true);
    expect(verifyStripeSignature(`${raw} `, signed(raw, WEBHOOK_SECRET, now), WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(raw, signed(raw, 'whsec_other123456789', now), WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(raw, signed(raw, WEBHOOK_SECRET, now - 301), WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(raw, `t=${now},v1=deadbeef,${signed(raw, WEBHOOK_SECRET, now).split(',')[1]}`, WEBHOOK_SECRET, now)).toBe(true);
    expect(verifyStripeSignature(raw, undefined, WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(raw, 'garbage', WEBHOOK_SECRET, now)).toBe(false);
  });
});

describe('supporting by card (Stripe Checkout)', () => {
  it('is off without a Stripe key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await call(stripeCheckoutHandler, { forSelf: true })).statusCode).toBe(404);
    expect((await call(stripeConfirmHandler, { sessionId: SESSION_ID })).statusCode).toBe(404);
  });

  it('refuses every checkout without Twitch sign-in, unknown tiers, and support amounts outside $5–$500', async () => {
    sessionUser = null;
    expect((await call(stripeCheckoutHandler, { forSelf: true })).statusCode).toBe(401);
    sessionUser = { id: '999', login: 'buyer', displayName: 'Buyer' };
    expect((await call(stripeCheckoutHandler, { forSelf: true, tier: 'gold' })).statusCode).toBe(400);
    expect((await call(stripeCheckoutHandler, { amountCents: 499 })).statusCode).toBe(400);
    expect((await call(stripeCheckoutHandler, { amountCents: 50_001 })).statusCode).toBe(400);
    expect(created).toBeNull();
  });

  it('creates a one-time USD session for exactly the amount set here, then grants on a verified payment', async () => {
    const start = await call(stripeCheckoutHandler, { login: '@Viewer', tier: 'suvy', amountCents: 1 });
    expect(start).toEqual({ statusCode: 200, body: { url: `https://checkout.stripe.com/c/pay/${SESSION_ID}` } });
    expect(created!.get('mode')).toBe('payment');
    expect(created!.get('line_items[0][price_data][currency]')).toBe('usd');
    /* The tier's price, set here: the browser's amount is ignored for a badge. */
    expect(created!.get('line_items[0][price_data][unit_amount]')).toBe('1000');
    expect(created!.get('metadata[recipient_id]')).toBe('123');
    expect(created!.get('success_url')).toBe('http://localhost:3000/support?stripe=return&session_id={CHECKOUT_SESSION_ID}');
    /* Stripe, through Link, sells it: the buyer pays exactly what the page
       showed, with any sales tax inside that amount. */
    expect(created!.get('managed_payments[enabled]')).toBe('true');
    expect(created!.get('automatic_tax[enabled]')).toBeNull();
    expect(created!.get('line_items[0][price_data][tax_behavior]')).toBe('inclusive');
    expect(created!.get('line_items[0][price_data][product_data][name]')).toBe('FlossChat Suvy badge for viewer');
    expect(created!.get('line_items[0][price_data][product_data][tax_code]')).toBe('txcd_10000000');
    expect(createdHeaders['Idempotency-Key']).toBe(`create-${created!.get('client_reference_id')}`);

    const confirmed = await call(stripeConfirmHandler, { sessionId: SESSION_ID });
    expect(confirmed).toEqual({ statusCode: 200, body: { status: 'completed', recipient: { login: 'viewer', displayName: 'Viewer' }, tier: 'suvy' } });
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['123']);

    /* Coming back twice doesn't ask Stripe or grant again. */
    await call(stripeConfirmHandler, { sessionId: SESSION_ID });
    expect(lookups).toBe(1);
  });

  it('when Stripe refuses a checkout: says why in the server log (and on the page in dev), never a key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://api.stripe.com/v1/checkout/sessions') {
        return Promise.resolve(json({
          error: {
            type: 'invalid_request_error',
            message: 'In order to use Checkout, you must set an account or business name. Key: sk_test_****mnop',
          },
        }, 400));
      }
      return stripeFetch(input, init);
    }));
    const reason = 'Stripe checkout could not be created (HTTP 400 invalid_request_error): '
      + 'In order to use Checkout, you must set an account or business name. Key: [key]';
    const start = await call(stripeCheckoutHandler, { forSelf: true });
    expect(start).toEqual({ statusCode: 502, body: { error: 'Card checkout is not available right now.', detail: reason } });
    expect(warn).toHaveBeenCalledWith(`[stripe checkout] failed: ${reason}`);

    vi.stubEnv('NODE_ENV', 'production');
    expect((await call(stripeCheckoutHandler, { forSelf: true })).body).toEqual({ error: 'Card checkout is not available right now.' });
    warn.mockRestore();
  });

  it('uses the owner’s product, with its own tax code, when set', async () => {
    vi.stubEnv('STRIPE_PRODUCT_ID', 'prod_FlossBadge1');
    await call(stripeCheckoutHandler, { forSelf: true });
    expect(created!.get('line_items[0][price_data][product]')).toBe('prod_FlossBadge1');
    expect(created!.get('line_items[0][price_data][product_data][name]')).toBeNull();
    expect(created!.get('line_items[0][price_data][product_data][tax_code]')).toBeNull();
    expect(created!.get('line_items[0][price_data][tax_behavior]')).toBe('inclusive');
    expect(created!.get('managed_payments[enabled]')).toBe('true');
    expect(created!.get('automatic_tax[enabled]')).toBeNull();
  });

  it('plain Stripe (STRIPE_MANAGED_PAYMENTS=0) turns both Managed Payments and tax off', async () => {
    vi.stubEnv('STRIPE_MANAGED_PAYMENTS', '0');
    await call(stripeCheckoutHandler, { forSelf: true });
    expect(created!.get('managed_payments[enabled]')).toBe('false');
    expect(created!.get('automatic_tax[enabled]')).toBe('false');
    expect(created!.get('line_items[0][price_data][tax_behavior]')).toBeNull();
    expect(created!.get('line_items[0][price_data][product_data][tax_code]')).toBeNull();
    expect((await call(stripeConfirmHandler, { sessionId: SESSION_ID })).statusCode).toBe(200);
  });

  it('takes support without a badge by card only on plain Stripe', async () => {
    const tip = await call(stripeCheckoutHandler, { amountCents: 500 });
    expect(tip).toEqual({ statusCode: 400, body: { error: 'Card checkout is for badges. Use PayPal to support without a badge.' } });
    expect(created).toBeNull();
    vi.stubEnv('STRIPE_MANAGED_PAYMENTS', '0');
    expect((await call(stripeCheckoutHandler, { amountCents: 500 })).statusCode).toBe(200);
    expect(created!.get('line_items[0][price_data][product_data][name]')).toBe('Support FlossChat');
  });

  it('never grants when Stripe reports a different amount, currency, reference or recipient, or no payment yet', async () => {
    const cases: ((form: URLSearchParams) => Record<string, unknown>)[] = [
      (form) => ({ ...paidSession(form), amount_subtotal: 500 }),
      /* Tax added on top of the price instead of included in it. */
      (form) => ({ ...paidSession(form), amount_total: Number(form.get('line_items[0][price_data][unit_amount]')) + 89 }),
      (form) => ({ ...paidSession(form), amount_total: null }),
      (form) => ({ ...paidSession(form), currency: 'eur' }),
      (form) => ({ ...paidSession(form), client_reference_id: 'someone-else' }),
      (form) => ({ ...paidSession(form), metadata: { ...(paidSession(form).metadata as object), recipient_id: '666' } }),
      (form) => ({ ...paidSession(form), status: 'open', payment_status: 'unpaid' }),
    ];
    for (const override of cases) {
      created = null;
      __resetStripeCheckoutLimitForTests();
      await call(stripeCheckoutHandler, { forSelf: true, tier: 'suvy' });
      sessionOverride = override;
      const result = await call(stripeConfirmHandler, { sessionId: SESSION_ID });
      expect(result.statusCode).toBe(409);
      __closeSupporterStoresForTests();
      rmSync(storePath, { force: true });
    }
  });

  it('says "pending" while a slower method clears, and lets the webhook grant later', async () => {
    await call(stripeCheckoutHandler, { forSelf: true });
    sessionOverride = (form) => ({ ...paidSession(form), payment_status: 'unpaid' });
    expect((await call(stripeConfirmHandler, { sessionId: SESSION_ID })).statusCode).toBe(202);
    sessionOverride = null;
    const event = { id: 'evt_1', type: 'checkout.session.async_payment_succeeded', livemode: false, data: { object: { id: SESSION_ID } } };
    expect(await postWebhook(event)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['999']);
  });

  it('a tier already reached is refused by card too, and the next one costs the difference', async () => {
    await call(stripeCheckoutHandler, { forSelf: true, tier: 'supporter' });
    await call(stripeConfirmHandler, { sessionId: SESSION_ID });
    created = null;
    const again = await call(stripeCheckoutHandler, { forSelf: true, tier: 'supporter' });
    expect(again.statusCode).toBe(409);
    expect(created).toBeNull();
    expect((await call(stripeCheckoutHandler, { forSelf: true, tier: 'top-suvy' })).statusCode).toBe(200);
    expect(created!.get('line_items[0][price_data][unit_amount]')).toBe('1500');
  });

  it('ignores sessions this server did not create, and bad ids', async () => {
    expect((await call(stripeConfirmHandler, { sessionId: SESSION_ID })).statusCode).toBe(404);
    expect((await call(stripeConfirmHandler, { sessionId: '../../x' })).statusCode).toBe(400);
    expect((await call(stripeConfirmHandler, {}, 'GET')).statusCode).toBe(405);
  });
});

describe('Stripe webhook', () => {
  it('refuses unsigned or tampered events, and is off without a signing secret', async () => {
    await call(stripeCheckoutHandler, { forSelf: true });
    const event = { id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: SESSION_ID } } };
    expect(await postWebhook(event, 't=1,v1=abc')).toBe(400);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect(await postWebhook(event)).toBe(404);
  });

  it('grants a completed checkout only after re-reading it from Stripe', async () => {
    await call(stripeCheckoutHandler, { forSelf: true });
    sessionOverride = (form) => ({ ...paidSession(form), amount_subtotal: 1 });
    const event = { id: 'evt_2', type: 'checkout.session.completed', livemode: false, data: { object: { id: SESSION_ID, amount_subtotal: 500, payment_status: 'paid' } } };
    expect(await postWebhook(event)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
    sessionOverride = null;
    expect(await postWebhook(event)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['999']);
  });

  it('a refund or a dispute takes the badge back', async () => {
    await call(stripeCheckoutHandler, { forSelf: true });
    await call(stripeConfirmHandler, { sessionId: SESSION_ID });
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['999']);
    expect(await postWebhook({ id: 'evt_3', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_1', payment_intent: INTENT_ID } } })).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
  });

  it('never lets a live event touch sandbox orders', async () => {
    await call(stripeCheckoutHandler, { forSelf: true });
    const event = { id: 'evt_4', type: 'checkout.session.completed', livemode: true, data: { object: { id: SESSION_ID } } };
    expect(await postWebhook(event)).toBe(200);
    expect(lookups).toBe(0);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
  });
});

describe('support status', () => {
  it('says whether the card button can show, and never shows any Stripe key', async () => {
    const status = await call(async (req, res) => { await statusHandler(req, res); }, undefined, 'GET');
    expect(status.body.stripe).toBe(true);
    expect(JSON.stringify(status.body)).not.toMatch(/sk_test|whsec_/);
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const off = await call(async (req, res) => { await statusHandler(req, res); }, undefined, 'GET');
    expect(off.body.stripe).toBeUndefined();
  });
});
