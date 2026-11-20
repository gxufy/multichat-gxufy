import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Checkout needs a signed-in buyer; the session itself is tested in twitchSignIn.test.ts. */
let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));

import checkoutHandler, { __resetSupportCheckoutLimitForTests } from '@/pages/api/support/checkout';
import captureHandler from '@/pages/api/support/capture';
import webhookHandler, { captureIdFromEvent, orderIdFromCaptureEvent } from '@/pages/api/support/paypal-webhook';
import { __resetPayPalForTests, isPayPalCheckoutUrl, paypalConfig } from '@/lib/server/paypal';
import { SupporterStore, __closeSupporterStoresForTests } from '@/lib/server/supporterStore';
import { getGxufyBadges } from '@/lib/server/gxufyBadges';
import { __resetSupportTwitchUserResourcesForTests } from '@/pages/api/twitch/support-user';
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
  const req = { method: 'POST', body: event, query: {}, headers: WEBHOOK_HEADERS } as unknown as NextApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as NextApiResponse;
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
  const req = { method, body, query: {}, headers: { host }, socket: { remoteAddress: '203.0.113.30' } } as unknown as NextApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as NextApiResponse;
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

describe('supporter checkout ($5 or more)', () => {
  it('is off without PayPal keys', async () => {
    vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    expect((await call(checkoutHandler, {})).statusCode).toBe(404);
    expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode).toBe(404);
  });

  it('creates a fixed $5 order for the Twitch ID the server resolved, then grants on a verified capture', async () => {
    const created = await call(checkoutHandler, { login: '@Viewer', amount: '0.01' });
    expect(created.statusCode).toBe(200);
    expect(created.body.approveUrl).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`);
    const unit = createdBody!.purchase_units[0];
    expect(unit.amount).toEqual({ currency_code: 'USD', value: '5.00' });
    expect(unit.custom_id).toBe('twitch:123');
    expect(createdBody!.payment_source.paypal.experience_context.return_url).toBe('http://localhost:3000/support?paypal=return');

    const captured = await call(captureHandler, { orderId: ORDER_ID });
    expect(captured).toEqual({ statusCode: 200, body: { status: 'completed', recipient: { login: 'viewer', displayName: 'Viewer' } } });
    const store = new SupporterStore(storePath);
    expect(await store.supporterIds()).toEqual(['123']);
    const badges = await getGxufyBadges(store);
    expect(badges[0]!.userIds).toEqual(['204219574', '123']);

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

  it('takes any amount from $5 to $500, sets it on the order, and grants only that exact amount', async () => {
    const order = await call(checkoutHandler, { login: 'viewer', amountCents: 750 });
    expect(order.statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '7.50' });
    expect((await new SupporterStore(storePath).getOrder(ORDER_ID))!.amountCents).toBe(750);

    /* PayPal capturing $5 for a $7.50 order (or a cent more) is not that payment. */
    for (const value of ['5.00', '7.51', '7.5']) {
      captureOverride = (ref) => completedOrder(ref, 'twitch:123', value);
      expect((await call(captureHandler, { orderId: ORDER_ID })).statusCode, value).toBe(409);
    }
    expect(await new SupporterStore(storePath).supporterIds()).toEqual([]);
    captureOverride = (ref) => completedOrder(ref, 'twitch:123', '7.50');
    expect((await call(captureHandler, { orderId: ORDER_ID })).body.status).toBe('completed');
    expect(await new SupporterStore(storePath).supporterIds()).toEqual(['123']);
  });

  it('defaults to $5, and refuses amounts under $5, over $500 or not in whole cents', async () => {
    await call(checkoutHandler, { login: 'viewer' });
    expect(createdBody!.purchase_units[0].amount.value).toBe('5.00');
    for (const amountCents of [499, 0, -500, 50_001, 500.5, '500', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      createdBody = null;
      __resetSupportCheckoutLimitForTests();
      const out = await call(checkoutHandler, { forSelf: true, amountCents });
      expect(out.statusCode, String(amountCents)).toBe(400);
      expect(out.body.error).toBe('Choose an amount of $5 or more (up to $500).');
      expect(createdBody).toBeNull();
    }
    __resetSupportCheckoutLimitForTests();
    expect((await call(checkoutHandler, { forSelf: true, amountCents: 50_000 })).statusCode).toBe(200);
    expect(createdBody!.purchase_units[0].amount.value).toBe('500.00');
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
