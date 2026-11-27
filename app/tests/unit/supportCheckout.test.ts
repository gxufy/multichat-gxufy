import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Checkout needs a signed-in buyer; the session itself is tested in twitchSignIn.test.ts. */
let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));

import checkoutHandler, { __resetSupportCheckoutLimitForTests } from '@/api/support/checkout';
import captureHandler from '@/api/support/capture';
import statusHandler from '@/api/support/status';
import webhookHandler, { captureIdFromEvent, orderIdFromCaptureEvent } from '@/api/support/paypal-webhook';
import { __resetPayPalForTests, isPayPalCheckoutUrl, paypalConfig } from '@/lib/server/paypal';
import { SupporterStore, __closeSupporterStoresForTests } from '@/lib/server/supporterStore';
import { getGxufyBadges, getGxufyHolders } from '@/lib/server/gxufyBadges';
import { __resetSupportTwitchUserResourcesForTests } from '@/api/twitch/support-user';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

const ORDER_ID = '5O190127TN364715T';
const CAPTURE_ID = '3C679366HH908993F';
let dir = '';
let storePath = '';
let createdBody: Record<string, any> | null = null;
let captureOverride: ((ref: string) => unknown) | null = null;
let captureCalls = 0;
let orderLookup: ((ref: string) => unknown) | null = null;
let webhookVerified = true;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function paypalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://gql.twitch.tv/gql') {
    return Promise.resolve(json({ data: { user: { id: '123', login: 'viewer', displayName: 'Viewer', profileImageURL: null } } }));
  }
  if (url === 'https://api-m.sandbox.paypal.com/v1/oauth2/token') {
    return Promise.resolve(json({ access_token: 'sandbox-token', expires_in: 3600 }));
  }
  if (url === 'https://api-m.sandbox.paypal.com/v2/checkout/orders' && init?.method === 'POST') {
    createdBody = JSON.parse(String(init.body));
    return Promise.resolve(json({
      id: ORDER_ID,
      status: 'PAYER_ACTION_REQUIRED',
      links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}` }],
    }, 201));
  }
  if (url === `https://api-m.sandbox.paypal.com/v2/checkout/orders/${ORDER_ID}/capture`) {
    captureCalls += 1;
    const ref = createdBody!.purchase_units[0].reference_id;
    return Promise.resolve(json(captureOverride ? captureOverride(ref) : {
      id: ORDER_ID,
      status: 'COMPLETED',
      purchase_units: [{
        reference_id: ref,
        payments: { captures: [{ id: CAPTURE_ID, status: 'COMPLETED', custom_id: 'twitch:123', amount: { currency_code: 'USD', value: '5.00' } }] },
      }],
    }, 201));
  }
  if (url === 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature') {
    return Promise.resolve(json({ verification_status: webhookVerified ? 'SUCCESS' : 'FAILURE' }));
  }
  if (url === `https://api-m.sandbox.paypal.com/v2/checkout/orders/${ORDER_ID}` && orderLookup) {
    return Promise.resolve(json(orderLookup(createdBody!.purchase_units[0].reference_id)));
  }
  return Promise.reject(new Error(`unexpected ${url}`));
}

const WEBHOOK_HEADERS = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT',
  'paypal-transmission-id': 'tid',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-11-16T00:00:00Z',
};

async function postWebhook(event: unknown) {
  let statusCode = 200;
  const req = { method: 'POST', body: event, query: {}, headers: WEBHOOK_HEADERS } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as ApiResponse;
  await webhookHandler(req, res);
  return statusCode;
}

function completedOrder(ref: string, customId = 'twitch:123', value = '5.00') {
  return {
    id: ORDER_ID,
    status: 'COMPLETED',
    purchase_units: [{
      reference_id: ref,
      payments: { captures: [{ id: CAPTURE_ID, status: 'COMPLETED', custom_id: customId, amount: { currency_code: 'USD', value } }] },
    }],
  };
}

const CAPTURE_COMPLETED_EVENT = {
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: CAPTURE_ID, status: 'COMPLETED', supplementary_data: { related_ids: { order_id: ORDER_ID } } },
};

async function call(handler: typeof checkoutHandler, body: unknown, method = 'POST', host = 'localhost:3000') {
  let statusCode = 200;
  let payload: unknown;
  const req = { method, body, query: {}, headers: { host }, socket: { remoteAddress: '203.0.113.30' } } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as ApiResponse;
  await handler(req, res);
  return { statusCode, body: payload as any };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gx-support-'));
  storePath = path.join(dir, 'supporters.db');
  vi.stubEnv('GXUFY_SUPPORT_PAGE_ENABLED', '1');
  vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-client');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'sandbox-secret');
  vi.stubEnv('PAYPAL_ENV', 'sandbox');
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', storePath);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('fetch', vi.fn(paypalFetch));
  createdBody = null;
  captureOverride = null;
  captureCalls = 0;
  orderLookup = null;
  webhookVerified = true;
  sessionUser = { id: '999', login: 'buyer', displayName: 'Buyer' };
  __resetPayPalForTests();
  __resetSupportTwitchUserResourcesForTests();
  __resetSupportCheckoutLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetFixedProviderResourcesForTests();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('PayPal configuration', () => {
  it('needs both keys, defaults to sandbox, and refuses live without explicit approval', () => {
    expect(paypalConfig({} as any)).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: 'a' } as any)).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b' } as any)?.apiBase).toBe('https://api-m.sandbox.paypal.com');
    expect(paypalConfig({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', PAYPAL_ENV: 'live' } as any)).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', PAYPAL_ENV: 'live', GXUFY_PAYPAL_LIVE_APPROVED: '1' } as any)?.apiBase).toBe('https://api-m.paypal.com');
  });

  it('only sends buyers to PayPal checkout pages', () => {
    expect(isPayPalCheckoutUrl('https://www.sandbox.paypal.com/checkoutnow?token=X')).toBe(true);
    expect(isPayPalCheckoutUrl('https://www.paypal.com/checkoutnow?token=X')).toBe(true);
    expect(isPayPalCheckoutUrl('https://paypal.com.evil.example/checkoutnow')).toBe(false);
    expect(isPayPalCheckoutUrl('http://www.paypal.com/checkoutnow')).toBe(false);
  });
});

/* Who holds each badge (worn or not), and who shows it in chat (one each).
   The owner's account holds every badge; badgeHolders leaves it out of all
   but Owner, so these tests see what paying and giving do. */
const OWNER = '204219574';
const badgeHolders = async (store: SupporterStore) => Object.fromEntries(Object.entries(await getGxufyHolders(store))
  .map(([id, ids]) => [id, id === 'owner' ? ids : ids.filter((holder) => holder !== OWNER)]));
const badgeShown = async (store: SupporterStore) =>
  Object.fromEntries((await getGxufyBadges(store)).map((badge) => [badge.id, badge.userIds]));

/* An earlier, completed purchase for a Twitch account (order ids must differ from ORDER_ID). */
async function paidBefore(store: SupporterStore, id: string, cents: number, n: number, login = 'viewer') {
  const orderId = `EARLIER${String(n).padStart(10, '0')}`;
  await store.recordCreated({ orderId, reference: `ref-${n}`, recipient: { id, login, displayName: login }, kind: 'gift', amountCents: cents });
  await store.markCompleted(orderId, `CAPEARLIER${String(n).padStart(7, '0')}`);
}

describe('supporter checkout (tiers)', () => {
  it('is off without PayPal keys', async () => {
    vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    expect((await call(checkoutHandler, {})).statusCode).toBe(404);
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(404);
  });

  it('creates a $5 Sanctioned order for the Twitch ID the server resolved, then grants on a verified capture', async () => {
    const created = await call(checkoutHandler, { login: '@Viewer', tier: 'supporter', amount: '0.01', amountCents: 1 });
    expect(created.statusCode).toBe(200);
    expect(created.body.approveUrl).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`);
    const unit = createdBody!.purchase_units[0];
    expect(unit.amount).toEqual({ currency_code: 'USD', value: '5.00' });
    expect(unit.custom_id).toBe('twitch:123');
    expect(createdBody!.payment_source.paypal.experience_context.return_url).toBe('http://localhost:3000/support?paypal=return');

    const captured = await call(captureHandler, { orderId: ORDER_ID });
    expect(captured).toEqual({ statusCode: 200, body: { status: 'completed', recipient: { login: 'viewer', displayName: 'Viewer' }, tier: 'supporter' } });
    const store = new SupporterStore(storePath);
    expect(await store.supporterIds()).toEqual(['123']);
    expect((await store.getOrder(ORDER_ID))!.tier).toBe('supporter');
    expect(await badgeHolders(store)).toEqual({
      owner: ['204219574'], founder: ['123'], 'top-suvy': [], suvy: [], supporter: ['123'],
    });
    /* One badge shows at a time: their tier first, until they pick Founder. */
    expect(await badgeShown(store)).toEqual({
      owner: ['204219574'], founder: [], 'top-suvy': [], suvy: [], supporter: ['123'],
    });

    /* Refreshing the return page doesn't capture or grant again. */
    const again = await call(captureHandler, { orderId: ORDER_ID });
    expect(again.body.status).toBe('completed');
    expect(captureCalls).toBe(1);
  });

  it('sends the owner one Discord notice per purchase, with no buyer details', async () => {
    const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789';
    vi.stubEnv('GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL', WEBHOOK);
    const discordBodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === WEBHOOK) {
        discordBodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return paypalFetch(input, init);
    }));
    await call(checkoutHandler, { login: 'viewer' });
    await call(captureHandler, { orderId: ORDER_ID });
    await call(captureHandler, { orderId: ORDER_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(discordBodies).toHaveLength(1);
    const text = JSON.stringify(discordBodies[0]);
    expect(text).toContain('viewer');
    expect(text).toContain('123');
    expect(text).toContain('Gift');
    expect(text).toContain('$5.00 USD');
    expect(text).toContain(ORDER_ID);
    expect(text).not.toMatch(/@|email|payer/i);
    expect(discordBodies[0].allowed_mentions).toEqual({ parse: [] });
  });

  it('prices a badge by its tier on the server, never by the browser, and grants only that exact amount', async () => {
    const order = await call(checkoutHandler, { login: 'viewer', tier: 'suvy', amountCents: 50 });
    expect(order.statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '10.00' });
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Suvy badge for viewer');
    const stored = (await new SupporterStore(storePath).getOrder(ORDER_ID))!;
    expect([stored.amountCents, stored.tier]).toEqual([1000, 'suvy']);

    /* PayPal capturing $5 for a $10 order (or a cent more) is not that payment. */
    for (const value of ['5.00', '10.01', '10.0']) {
      captureOverride = (ref) => completedOrder(ref, 'twitch:123', value);
      expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode, value).toBe(409);
    }
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
    captureOverride = (ref) => completedOrder(ref, 'twitch:123', '10.00');
    expect((await call(captureHandler, { orderId: ORDER_ID })).body.status).toBe('completed');
    const holders = await badgeHolders(new SupporterStore(storePath));
    /* Suvy keeps the tier below it (Sanctioned); Suvy is the one shown. */
    expect([holders.suvy, holders.supporter, holders.founder]).toEqual([['123'], ['123'], ['123']]);
    expect(await badgeShown(new SupporterStore(storePath))).toMatchObject({ suvy: ['123'], supporter: [], founder: [] });
  });

  it('prices each tier: $5, $10, $25; refuses unknown tiers and a tier with no one to get it', async () => {
    for (const [tier, value] of [['supporter', '5.00'], ['suvy', '10.00'], ['top-suvy', '20.00']] as const) {
      __resetSupportCheckoutLimitForTests();
      createdBody = null;
      expect((await call(checkoutHandler, { forSelf: true, tier, amountCents: 1 })).statusCode, tier).toBe(200);
      expect(createdBody!.purchase_units[0].amount.value, tier).toBe(value);
    }
    __resetSupportCheckoutLimitForTests();
    createdBody = null;
    expect(await call(checkoutHandler, { forSelf: true, tier: 'gold' })).toEqual({ statusCode: 400, body: { error: 'Pick a badge tier.' } });
    expect(await call(checkoutHandler, { tier: 'suvy' })).toEqual({ statusCode: 400, body: { error: 'Pick who gets the badge.' } });
    expect(createdBody).toBeNull();
  });

  it('support without a badge takes any amount from $5 to $500 (defaults to $5); an older page pays the amount it shows for a badge', async () => {
    await call(checkoutHandler, {});
    expect(createdBody!.purchase_units[0].amount.value).toBe('5.00');
    expect(createdBody!.purchase_units[0].description).toBe('Support FlossChat');
    expect(createdBody!.payment_source.paypal.experience_context.brand_name).toBe('FlossChat');
    for (const amountCents of [499, 0, -500, 50_001, 500.5, '500', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      createdBody = null;
      __resetSupportCheckoutLimitForTests();
      const out = await call(checkoutHandler, { amountCents });
      expect(out.statusCode, String(amountCents)).toBe(400);
      expect(out.body.error).toBe('Choose an amount of $5 or more (up to $500).');
      expect(createdBody).toBeNull();
    }
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { amountCents: 50_000 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('500.00');
    expect(createdBody!.purchase_units[0].custom_id).toBe('none');
    /* An older page (no tier) sends its own amount for a badge: that is what
       its button showed, so that is what is charged, and it names the tier it
       reaches. Out-of-range amounts are refused the same way. */
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { forSelf: true, amountCents: 700 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('7.00');
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Sanctioned badge for buyer');
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { login: 'viewer', amountCents: 1_200 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('12.00');
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Suvy badge for viewer');
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { forSelf: true })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('5.00');
    __resetSupportCheckoutLimitForTests();
    createdBody = null;
    expect((await call(checkoutHandler, { forSelf: true, amountCents: 499 })).statusCode).toBe(400);
    expect(createdBody).toBeNull();
  });

  it('never grants when PayPal reports a different amount, currency or recipient', async () => {
    await call(checkoutHandler, { login: 'viewer' });
    captureOverride = (ref) => ({
      id: ORDER_ID,
      status: 'COMPLETED',
      purchase_units: [{
        reference_id: ref,
        payments: { captures: [{ id: CAPTURE_ID, status: 'COMPLETED', custom_id: 'twitch:999', amount: { currency_code: 'USD', value: '5.00' } }] },
      }],
    });
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(409);
    captureOverride = (ref) => ({
      id: ORDER_ID,
      status: 'COMPLETED',
      purchase_units: [{
        reference_id: ref,
        payments: { captures: [{ id: CAPTURE_ID, status: 'COMPLETED', custom_id: 'twitch:123', amount: { currency_code: 'USD', value: '0.01' } }] },
      }],
    });
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(409);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
  });

  it('ignores orders this server did not create, bad ids, and GETs', async () => {
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(404);
    expect((await call(captureHandler, { orderId: '../../x' })).statusCode).toBe(400);
    expect((await call(checkoutHandler, {}, 'GET')).statusCode).toBe(405);
    expect((await call(checkoutHandler, { login: 'not a name!' })).statusCode).toBe(400);
  });

  it('refuses every checkout without Twitch sign-in', async () => {
    sessionUser = null;
    for (const body of [{}, { login: 'viewer' }, { forSelf: true }]) {
      const out = await call(checkoutHandler, body);
      expect(out.statusCode).toBe(401);
      expect(out.body.error).toBe('Sign in with Twitch to support.');
    }
    expect(createdBody).toBeNull();
  });

  it('sends "For you" to the signed-in account, never a name from the request', async () => {
    await call(checkoutHandler, { forSelf: true, login: 'someoneelse' });
    expect(createdBody!.purchase_units[0].custom_id).toBe('twitch:999');
  });

  it('lets a signed-in visitor support without a badge', async () => {
    const created = await call(checkoutHandler, {});
    expect(created.statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].custom_id).toBe('none');
  });

  it('stays off in production unless a supporter store path is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', '');
    expect((await call(checkoutHandler, {})).statusCode).toBe(404);
  });

  it('uses the canonical site for PayPal return links outside npm run dev', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await call(checkoutHandler, {}, 'POST', 'evil.example');
    expect(createdBody!.payment_source.paypal.experience_context.return_url).toBe('https://flosschat.app/support?paypal=return');
  });
});

describe('PayPal buttons on the support page', () => {
  const statusRoute: typeof checkoutHandler = async (req, res) => { await statusHandler(req, res); };

  it('gives the page the public PayPal client ID once checkout is ready, never the secret', async () => {
    const ready = await call(statusRoute, undefined, 'GET');
    expect(ready.statusCode).toBe(200);
    expect(ready.body.checkoutReady).toBe(true);
    expect(ready.body.paypal).toEqual({ clientId: 'sandbox-client', env: 'sandbox' });
    expect(JSON.stringify(ready.body)).not.toContain('sandbox-secret');

    vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    const off = await call(statusRoute, undefined, 'GET');
    expect(off.body.checkoutReady).toBe(false);
    expect(off.body.paypal).toBeUndefined();
  });

  it('creates the order for the button pressed, and returns its id for PayPal\'s window', async () => {
    const paypal = await call(checkoutHandler, { forSelf: true, tier: 'top-suvy', fundingSource: 'paypal' });
    expect(paypal.statusCode).toBe(200);
    expect(paypal.body.orderId).toBe(ORDER_ID);
    expect(createdBody!.payment_source.paypal.experience_context.shipping_preference).toBe('NO_SHIPPING');
    expect(createdBody!.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '20.00' });
    expect(createdBody!.purchase_units[0].custom_id).toBe('twitch:999');

    await call(checkoutHandler, { forSelf: true, fundingSource: 'venmo' });
    expect(createdBody!.payment_source).toEqual({ venmo: { experience_context: { brand_name: 'FlossChat', shipping_preference: 'NO_SHIPPING' } } });

    await call(checkoutHandler, { forSelf: true, fundingSource: 'paylater' });
    expect(createdBody!.payment_source.paypal).toBeTruthy();

    await call(checkoutHandler, { forSelf: true, fundingSource: 'card' });
    expect(createdBody!.payment_source).toBeUndefined();
  });

  it('refuses a payment method it does not know', async () => {
    const bad = await call(checkoutHandler, { forSelf: true, fundingSource: 'crypto' });
    expect(bad.statusCode).toBe(400);
    expect(createdBody).toBeNull();
  });

  it('a button order still grants only on a verified capture of the exact amount', async () => {
    const created = await call(checkoutHandler, { login: 'viewer', tier: 'supporter', fundingSource: 'venmo' });
    expect(created.body.orderId).toBe(ORDER_ID);
    const captured = await call(captureHandler, { orderId: created.body.orderId });
    expect(captured.body.status).toBe('completed');
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['123']);
  });
});

describe('payments add up', () => {
  it('moving up costs the difference; a tier already reached is refused, for yourself or as a gift', async () => {
    sessionUser = { id: '123', login: 'viewer', displayName: 'Viewer' };
    await call(checkoutHandler, { forSelf: true, tier: 'supporter' });
    expect((await call(captureHandler, { orderId: ORDER_ID })).body.status).toBe('completed');

    const again = await call(checkoutHandler, { forSelf: true, tier: 'supporter', fundingSource: 'paypal' });
    expect(again).toEqual({ statusCode: 409, body: { error: 'You already have Sanctioned. Pick a higher tier, or gift one.' } });
    createdBody = null;
    expect((await call(checkoutHandler, { forSelf: true, tier: 'suvy' })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('5.00');
    expect((await call(checkoutHandler, { forSelf: true, tier: 'top-suvy' })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('15.00');

    sessionUser = { id: '999', login: 'buyer', displayName: 'Buyer' };
    const gift = await call(checkoutHandler, { login: 'viewer', tier: 'supporter' });
    expect(gift).toEqual({ statusCode: 409, body: { error: 'Viewer already has Sanctioned. Pick a higher tier or someone else.' } });
    expect((await call(checkoutHandler, { login: 'viewer', tier: 'top-suvy' })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('15.00');

    /* Supporting without a badge stays open to everyone. */
    expect((await call(checkoutHandler, {})).statusCode).toBe(200);
  });

  it('any amount ($5–$500) buys the best tier the total reaches, also for someone who already has one', async () => {
    const store = new SupporterStore(storePath);
    sessionUser = { id: '123', login: 'viewer', displayName: 'Viewer' };
    await paidBefore(store, '123', 500, 1);

    /* Sanctioned already: $7 more makes $12, which reaches Suvy. */
    expect((await call(checkoutHandler, { forSelf: true, amountCents: 700 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('7.00');
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Suvy badge for viewer');
    /* PayPal reports the $7 that was asked for. */
    captureOverride = (ref) => completedOrder(ref, 'twitch:123', '7.00');
    const captured = await call(captureHandler, { orderId: ORDER_ID });
    expect(captured.body).toMatchObject({ status: 'completed', tier: 'suvy' });
    expect(await store.creditFor('123')).toBe(1_200);
    expect((await badgeHolders(store)).suvy).toEqual(['123']);

    /* It counts toward the next one: Top Suvy is now the $8 difference. */
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { forSelf: true, tier: 'top-suvy' })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('8.00');

    /* At the top already, any amount is still welcome and names Top Suvy. */
    await paidBefore(store, '123', 800, 2);
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { forSelf: true, amountCents: 500 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('5.00');
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Top Suvy badge for viewer');

    /* As a gift, the same. */
    sessionUser = { id: '999', login: 'buyer', displayName: 'Buyer' };
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { login: 'viewer', amountCents: 2_500 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('25.00');
    expect(createdBody!.purchase_units[0].description).toBe('FlossChat Top Suvy badge for viewer');

    /* Still only $5 to $500, and an amount-less request for a tier they
       hold is still refused. */
    for (const amountCents of [499, 50_001, 750.5]) {
      __resetSupportCheckoutLimitForTests();
      createdBody = null;
      expect((await call(checkoutHandler, { login: 'viewer', amountCents })).statusCode, String(amountCents)).toBe(400);
      expect(createdBody).toBeNull();
    }
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { login: 'viewer' })).statusCode).toBe(409);
  });

  it('the tier follows the total paid (minus refunds), and a free tier counts as its price', async () => {
    const store = new SupporterStore(storePath);
    await paidBefore(store, '123', 500, 1);
    expect((await badgeHolders(store)).supporter).toEqual(['123']);
    await paidBefore(store, '123', 500, 2);
    expect((await badgeHolders(store)).suvy).toEqual(['123']);
    await paidBefore(store, '123', 1500, 3);
    /* Reaching Top Suvy keeps Suvy and Sanctioned; Top Suvy shows. */
    expect(await badgeHolders(store)).toMatchObject({ 'top-suvy': ['123'], suvy: ['123'], supporter: ['123'] });
    expect(await badgeShown(store)).toMatchObject({ 'top-suvy': ['123'], suvy: [], supporter: [] });
    await store.markReversed('CAPEARLIER0000003');
    expect(await badgeHolders(store)).toMatchObject({ 'top-suvy': [], suvy: ['123'], supporter: ['123'] });
    expect(await badgeShown(store)).toMatchObject({ 'top-suvy': [], suvy: ['123'] });

    /* Given Suvy for free: Top Suvy costs the $10 difference. */
    await store.giveBadge({ id: '555', login: 'friend', displayName: 'Friend' }, new Date(), 'suvy');
    expect((await badgeHolders(store)).suvy).toEqual(['123', '555']);
    expect(await store.creditFor('555')).toBe(1000);
    sessionUser = { id: '555', login: 'friend', displayName: 'Friend' };
    expect((await call(checkoutHandler, { forSelf: true, tier: 'suvy' })).statusCode).toBe(409);
    expect((await call(checkoutHandler, { forSelf: true, tier: 'top-suvy' })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('10.00');
  });
});

describe('Founder and Owner badges', () => {
  it('Founder goes to the first 25 accounts with a standing paid badge (gifts count, free ones do not)', async () => {
    const store = new SupporterStore(storePath);
    await store.giveBadge({ id: '1', login: 'free', displayName: 'Free' });
    for (let n = 0; n < 27; n += 1) await paidBefore(store, String(1000 + n), 500, n, `fan${n}`);
    const founders = (await badgeHolders(store)).founder;
    expect(founders).toHaveLength(25);
    expect(founders).not.toContain('1');
    expect(founders).toContain('1000');
    expect(founders).not.toContain('1025');
    /* Upgrading later keeps a founder; a fully refunded one drops out and the next moves up. */
    await paidBefore(store, '1000', 500, 60, 'fan0');
    expect((await badgeHolders(store)).founder).toContain('1000');
    await store.markReversed('CAPEARLIER0000001');
    const after = (await badgeHolders(store)).founder;
    expect(after).not.toContain('1001');
    expect(after).toContain('1025');
    expect(after).toHaveLength(25);
  });

  it('the owner account holds every badge for free, wears one at a time, and takes no Founder spot', async () => {
    const store = new SupporterStore(storePath);
    const held = await getGxufyHolders(store);
    expect(Object.keys(held).filter((id) => held[id]!.includes(OWNER))).toEqual(['owner', 'founder', 'top-suvy', 'suvy', 'supporter']);
    expect((await badgeShown(store)).owner).toEqual([OWNER]);
    await store.selectBadge(OWNER, 'founder');
    expect(await badgeShown(store)).toMatchObject({ owner: [], founder: [OWNER], supporter: [] });
    await store.selectBadge(OWNER, 'top-suvy');
    expect(await badgeShown(store)).toMatchObject({ founder: [], 'top-suvy': [OWNER] });
    await store.setBadgeWorn(OWNER, false);
    expect(Object.values(await badgeShown(store)).flat()).toEqual([]);
    expect((await getGxufyHolders(store)).owner).toEqual([OWNER]);

    /* Holding Founder free takes none of the 25 spots. */
    const statusRoute: typeof checkoutHandler = async (req, res) => { await statusHandler(req, res); };
    expect((await call(statusRoute, undefined, 'GET')).body.founderSlotsLeft).toBe(25);
  });

  it('the support page learns how many Founder badges are left', async () => {
    const store = new SupporterStore(storePath);
    await paidBefore(store, '123', 500, 1);
    const statusRoute: typeof checkoutHandler = async (req, res) => { await statusHandler(req, res); };
    expect((await call(statusRoute, undefined, 'GET')).body.founderSlotsLeft).toBe(24);
  });
});

describe('checkout abuse limit', () => {
  it('lets one visitor start only a few checkouts per 10 minutes', async () => {
    const codes: number[] = [];
    for (let n = 0; n < 10; n += 1) codes.push((await call(checkoutHandler, {})).statusCode);
    expect(codes.filter((code) => code === 200)).toHaveLength(8);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });
});

describe('payments that were pending when the buyer came back', () => {
  beforeEach(() => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-123');
  });

  it('finds the order in a completed-capture event', () => {
    expect(orderIdFromCaptureEvent(CAPTURE_COMPLETED_EVENT)).toBe(ORDER_ID);
    expect(orderIdFromCaptureEvent({ resource: { supplementary_data: { related_ids: { order_id: '../x' } } } })).toBeNull();
  });

  it('grants once PayPal reports the capture completed, re-checking the order with PayPal', async () => {
    await call(checkoutHandler, { login: 'viewer' });
    captureOverride = (ref) => ({
      id: ORDER_ID,
      status: 'COMPLETED',
      purchase_units: [{
        reference_id: ref,
        payments: { captures: [{ id: CAPTURE_ID, status: 'PENDING', custom_id: 'twitch:123', amount: { currency_code: 'USD', value: '5.00' } }] },
      }],
    });
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(202);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);

    orderLookup = (ref) => completedOrder(ref);
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['123']);
    /* A repeat of the same event changes nothing. */
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['123']);
  });

  it('never grants from the event alone, a wrong amount/recipient, or an unverified webhook', async () => {
    await call(checkoutHandler, { login: 'viewer' });
    orderLookup = (ref) => completedOrder(ref, 'twitch:999');
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(200);
    orderLookup = (ref) => completedOrder(ref, 'twitch:123', '0.01');
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(200);
    webhookVerified = false;
    orderLookup = (ref) => completedOrder(ref);
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(400);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
  });

  it('ignores completed captures for orders this server did not create', async () => {
    orderLookup = (ref) => completedOrder(ref);
    expect(await postWebhook(CAPTURE_COMPLETED_EVENT)).toBe(200);
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
  });
});

describe('refunds take the badge back', () => {
  it('finds the capture in refund and reversal events', () => {
    expect(captureIdFromEvent({
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: 'REFUND123456', links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE_ID}` }] },
    })).toBe(CAPTURE_ID);
    expect(captureIdFromEvent({ event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { id: CAPTURE_ID } })).toBe(CAPTURE_ID);
    expect(captureIdFromEvent({ event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { id: 'x' } })).toBeNull();
  });

  it('a reversed capture is no longer a supporter', async () => {
    const store = new SupporterStore(storePath);
    await store.recordCreated({ orderId: ORDER_ID, reference: 'r', recipient: { id: '123', login: 'viewer', displayName: 'Viewer' }, amountCents: 500 });
    await store.markCompleted(ORDER_ID, CAPTURE_ID);
    expect(await store.supporterIds()).toEqual(['123']);
    await store.markReversed(CAPTURE_ID);
    expect(await store.supporterIds()).toEqual([]);
  });
});
