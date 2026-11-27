/* The server asks PayPal itself how its payments stand: refunds made anywhere
 * take the badge back, and payments that were still pending grant once PayPal
 * finishes them, with no webhook needed. */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import captureHandler from '@/api/support/capture';
import { __resetDrainForTests } from '@/lib/server/drain';
import { __resetPayPalForTests } from '@/lib/server/paypal';
import {
  PAYPAL_RECHECK_PER_TICK,
  PAYPAL_REVOKING_STATUSES,
  __resetPayPalRecheckForTests,
  dueForRecheck,
  payPalRecheckEnabled,
  payPalRecheckTick,
  payPalRechecksRunning,
  recheckEvery,
  runPayPalRecheck,
  startPayPalRechecks,
} from '@/lib/server/paypalRecheck';
import { checkoutDeps, type CheckoutDeps } from '@/lib/server/supportCheckout';
import { SupporterStore, __closeSupporterStoresForTests, type PayPalRecheckCandidate } from '@/lib/server/supporterStore';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const VIEWER = { id: '123', login: 'viewer', displayName: 'Viewer' };

let dir = '';
let storePath = '';
/** Capture id -> what PayPal answers: a capture body, an HTTP status, or a network error. */
let captureReplies: Record<string, unknown> = {};
/** Order id -> the order body PayPal returns for GET (undefined: 404). */
let orderReplies: Record<string, unknown> = {};
let captureCallReply: unknown = null;
let requests: { method: string; url: string }[] = [];
let logs: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function paypalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  if (url === `${SANDBOX}/v1/oauth2/token`) return Promise.resolve(json({ access_token: 'sandbox-token', expires_in: 3600 }));
  requests.push({ method, url: url.slice(SANDBOX.length) });
  const capture = /^\/v2\/payments\/captures\/([A-Z0-9]+)$/.exec(url.slice(SANDBOX.length));
  if (capture && method === 'GET') {
    const reply = captureReplies[capture[1]!];
    if (reply instanceof Error) return Promise.reject(reply);
    if (typeof reply === 'number') return Promise.resolve(json({ name: 'INTERNAL_SERVER_ERROR' }, reply));
    if (reply === undefined) return Promise.resolve(json({ name: 'RESOURCE_NOT_FOUND' }, 404));
    return Promise.resolve(json(reply));
  }
  const order = /^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/.exec(url.slice(SANDBOX.length));
  if (order && order[2] && method === 'POST') return Promise.resolve(json(captureCallReply, 201));
  if (order && method === 'GET') {
    const reply = orderReplies[order[1]!];
    return Promise.resolve(reply === undefined ? json({ name: 'RESOURCE_NOT_FOUND' }, 404) : json(reply));
  }
  return Promise.reject(new Error(`unexpected ${method} ${url}`));
}

function captureBody(id: string, status: string, reason?: string) {
  return { id, status, ...(reason ? { status_details: { reason } } : {}), amount: { currency_code: 'USD', value: '5.00' } };
}

function orderBody(orderId: string, reference: string, captureId: string, captureStatus: string, value = '5.00', customId = 'twitch:123') {
  return {
    id: orderId,
    status: 'COMPLETED',
    purchase_units: [{
      reference_id: reference,
      payments: { captures: [{ id: captureId, status: captureStatus, custom_id: customId, amount: { currency_code: 'USD', value } }] },
    }],
  };
}

function deps(): CheckoutDeps {
  const value = checkoutDeps();
  if (!value) throw new Error('checkout should be on');
  return value;
}

/** A completed $5 order for the viewer, completed now. */
async function paidOrder(store: SupporterStore, orderId: string, captureId: string, recipient = VIEWER) {
  await store.recordCreated({ orderId, reference: `ref-${orderId}`, recipient, amountCents: 500 });
  await store.markCompleted(orderId, captureId);
}

function run(at: number, options: Parameters<typeof runPayPalRecheck>[1] = {}) {
  return runPayPalRecheck(deps(), { now: () => at, gapMs: 0, log: (line) => logs.push(line), ...options });
}

async function postCapture(orderId: string) {
  let statusCode = 200;
  const req = { method: 'POST', body: { orderId }, query: {}, headers: {} } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as ApiResponse;
  await captureHandler(req, res);
  return statusCode;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-recheck-'));
  storePath = path.join(dir, 'supporters.db');
  vi.stubEnv('GXUFY_SUPPORT_PAGE_ENABLED', '1');
  vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-client');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'sandbox-secret');
  vi.stubEnv('PAYPAL_ENV', 'sandbox');
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', storePath);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubGlobal('fetch', vi.fn(paypalFetch));
  captureReplies = {};
  orderReplies = {};
  captureCallReply = null;
  requests = [];
  logs = [];
  __resetPayPalForTests();
  __resetPayPalRecheckForTests();
  __resetDrainForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetPayPalRecheckForTests();
  __resetDrainForTests();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('when an order is asked about', () => {
  const at = Date.parse('2026-11-23T22:00:00Z');
  const completed = (ageMs: number, checkedAgoMs: number | null = null): PayPalRecheckCandidate => ({
    orderId: 'ORDER00001',
    status: 'completed',
    captureId: 'CAPTURE0001',
    completedAt: new Date(at - ageMs).toISOString(),
    captureTriedAt: null,
    checkedAt: checkedAgoMs === null ? null : new Date(at - checkedAgoMs).toISOString(),
  });

  it('recent payments often, older ones less often, none after 180 days', () => {
    expect(recheckEvery(completed(HOUR), at)).toBe(10 * MINUTE);
    expect(recheckEvery(completed(3 * DAY), at)).toBe(6 * HOUR);
    expect(recheckEvery(completed(60 * DAY), at)).toBe(DAY);
    expect(recheckEvery(completed(181 * DAY), at)).toBeNull();
    const pending = { ...completed(0), status: 'created' as const, captureId: null, completedAt: null };
    expect(recheckEvery({ ...pending, captureTriedAt: new Date(at - HOUR).toISOString() }, at)).toBe(10 * MINUTE);
    expect(recheckEvery({ ...pending, captureTriedAt: new Date(at - 5 * DAY).toISOString() }, at)).toBe(3 * HOUR);
    expect(recheckEvery({ ...pending, captureTriedAt: new Date(at - 15 * DAY).toISOString() }, at)).toBeNull();
    expect(recheckEvery(pending, at)).toBeNull();
  });

  it('never right after the payment, then the most overdue first, a few per round, PayPal orders only', () => {
    expect(dueForRecheck([completed(5 * MINUTE)], at, 10)).toEqual([]);
    expect(dueForRecheck([completed(11 * MINUTE)], at, 10)).toHaveLength(1);
    expect(dueForRecheck([completed(HOUR, 5 * MINUTE)], at, 10)).toEqual([]);

    const older = { ...completed(3 * DAY, 7 * HOUR), orderId: 'ORDER00002' };
    const newer = { ...completed(HOUR, 30 * MINUTE), orderId: 'ORDER00003' };
    expect(dueForRecheck([newer, older], at, 10).map((c) => c.orderId)).toEqual(['ORDER00003', 'ORDER00002']);
    expect(dueForRecheck([newer, older], at, 1).map((c) => c.orderId)).toEqual(['ORDER00003']);

    const stripe = { ...completed(HOUR), orderId: 'cs_test_a1b2c3d4e5', captureId: 'pi_3Abc123456' };
    const stripeCapture = { ...completed(HOUR), captureId: 'pi_3Abc123456' };
    expect(dueForRecheck([stripe, stripeCapture], at, 10)).toEqual([]);
  });

  it('every status PayPal uses for a payment that no longer stands', () => {
    expect([...PAYPAL_REVOKING_STATUSES].sort()).toEqual(
      ['DECLINED', 'DENIED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED'],
    );
    expect(PAYPAL_REVOKING_STATUSES.has('COMPLETED')).toBe(false);
    expect(PAYPAL_REVOKING_STATUSES.has('PENDING')).toBe(false);
  });
});

describe('refunds take the badge back without a webhook', () => {
  it('a refund made on PayPal takes the badge back and frees the Founder spot', async () => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await store.founderIds(25)).toEqual(['123']);
    const revision = await store.revision();

    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'REFUNDED');
    const summary = await run(Date.now() + 11 * MINUTE);

    expect(summary).toMatchObject({ checked: 1, reversed: ['ORDER00001'], granted: [], failed: false });
    expect(await store.supporterIds()).toEqual([]);
    expect(await store.founderIds(25)).toEqual([]);
    expect((await store.getOrder('ORDER00001'))?.status).toBe('reversed');
    expect(await store.revision()).not.toBe(revision);
    expect(requests).toEqual([{ method: 'GET', url: '/v2/payments/captures/CAPTURE0001' }]);
    expect(logs.join('\n')).toContain('ORDER00001 is REFUNDED at PayPal');

    /* Reversed orders are never asked about again. */
    requests = [];
    expect((await run(Date.now() + DAY)).checked).toBe(0);
    expect(requests).toEqual([]);
  });

  it.each(['PARTIALLY_REFUNDED', 'DECLINED', 'FAILED', 'DENIED', 'REVERSED'])('%s takes the badge back', async (status) => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', status);
    expect((await run(Date.now() + 11 * MINUTE)).reversed).toEqual(['ORDER00001']);
    expect(await store.supporterIds()).toEqual([]);
  });

  it('a payment that still stands is left alone and asked about again only later', async () => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    const revision = await store.revision();
    const start = Date.now() + 11 * MINUTE;

    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'COMPLETED');
    expect(await run(start)).toMatchObject({ checked: 1, reversed: [], failed: false });
    expect(await store.revision()).toBe(revision);
    expect((await run(start + 5 * MINUTE)).checked).toBe(0);

    /* A chargeback in progress holds the money but is not final. */
    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'PENDING', 'CHARGEBACK');
    expect(await run(start + 11 * MINUTE)).toMatchObject({ checked: 1, reversed: [] });
    expect(await store.supporterIds()).toEqual(['123']);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('a capture PayPal does not know is left as is', async () => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    expect(await run(Date.now() + 11 * MINUTE)).toMatchObject({ checked: 1, reversed: [], failed: false });
    expect(await store.supporterIds()).toEqual(['123']);
    expect(logs.join('\n')).toContain('PayPal has no capture CAPTURE0001');
  });

  it.each([
    ['a PayPal error', 500],
    ['PayPal being unreachable', new Error('connect ECONNREFUSED')],
  ])('stops the round at %s and tries again next time, changing nothing', async (_label, reply) => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    await paidOrder(store, 'ORDER00002', 'CAPTURE0002', { ...VIEWER, id: '456' });
    captureReplies.CAPTURE0001 = reply;
    captureReplies.CAPTURE0002 = reply;

    const summary = await run(Date.now() + 11 * MINUTE);
    expect(summary).toMatchObject({ checked: 0, reversed: [], failed: true });
    expect(requests).toHaveLength(1);
    expect(await store.supporterIds()).toEqual(['123', '456']);
    expect(logs.join('\n')).not.toMatch(/sandbox-secret|sandbox-token/);

    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'REFUNDED');
    captureReplies.CAPTURE0002 = captureBody('CAPTURE0002', 'COMPLETED');
    expect(await run(Date.now() + 12 * MINUTE)).toMatchObject({ checked: 2, reversed: ['ORDER00001'] });
    expect(await store.supporterIds()).toEqual(['456']);
  });

  it('asks about at most a few orders per round, one at a time', async () => {
    const store = new SupporterStore(storePath);
    for (let i = 1; i <= PAYPAL_RECHECK_PER_TICK + 2; i += 1) {
      const n = String(i).padStart(5, '0');
      await paidOrder(store, `ORDER${n}`, `CAPTURE${n}`, { ...VIEWER, id: String(1000 + i) });
      captureReplies[`CAPTURE${n}`] = captureBody(`CAPTURE${n}`, 'COMPLETED');
    }
    const gaps: number[] = [];
    const summary = await runPayPalRecheck(deps(), {
      now: () => Date.now() + 11 * MINUTE,
      gapMs: 1_000,
      sleep: async (ms) => { gaps.push(ms); },
      log: () => undefined,
    });
    expect(summary.checked).toBe(PAYPAL_RECHECK_PER_TICK);
    expect(gaps).toEqual(Array(PAYPAL_RECHECK_PER_TICK - 1).fill(1_000));
    expect((await run(Date.now() + 11 * MINUTE)).checked).toBe(2);
  });

  it('payments older than PayPal\'s refund window are not asked about', async () => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'REFUNDED');
    expect((await run(Date.now() + 181 * DAY)).checked).toBe(0);
    expect(requests).toEqual([]);
  });
});

describe('payments still pending when the buyer came back', () => {
  const ORDER = 'ORDER00009';
  const CAPTURE = 'CAPTURE0009';

  async function pendingOrder(store: SupporterStore) {
    await store.recordCreated({ orderId: ORDER, reference: 'ref-9', recipient: VIEWER, amountCents: 500 });
    captureCallReply = orderBody(ORDER, 'ref-9', CAPTURE, 'PENDING');
    expect(await postCapture(ORDER)).toBe(202);
    expect(await store.supporterIds()).toEqual([]);
    requests = [];
  }

  it('grant once PayPal finishes them, with the purchase notice claimed once', async () => {
    const store = new SupporterStore(storePath);
    await pendingOrder(store);

    orderReplies[ORDER] = orderBody(ORDER, 'ref-9', CAPTURE, 'PENDING');
    expect(await run(Date.now() + 11 * MINUTE)).toMatchObject({ checked: 1, granted: [] });

    orderReplies[ORDER] = orderBody(ORDER, 'ref-9', CAPTURE, 'COMPLETED');
    expect(await run(Date.now() + 22 * MINUTE)).toMatchObject({ checked: 1, granted: [ORDER] });
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await store.getOrder(ORDER)).toMatchObject({ status: 'completed', captureId: CAPTURE });
    expect(await store.claimPurchaseNotice(ORDER)).toBe(false);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET /v2/checkout/orders/${ORDER}`,
      `GET /v2/checkout/orders/${ORDER}`,
    ]);
    expect(logs.join('\n')).toContain(`${ORDER} finished at PayPal; badge granted`);
  });

  it('never grant a different amount or recipient than the order', async () => {
    const store = new SupporterStore(storePath);
    await pendingOrder(store);
    orderReplies[ORDER] = orderBody(ORDER, 'ref-9', CAPTURE, 'COMPLETED', '0.01');
    expect((await run(Date.now() + 11 * MINUTE)).granted).toEqual([]);
    orderReplies[ORDER] = orderBody(ORDER, 'ref-9', CAPTURE, 'COMPLETED', '5.00', 'twitch:999');
    expect((await run(Date.now() + 22 * MINUTE)).granted).toEqual([]);
    expect(await store.supporterIds()).toEqual([]);
  });

  it('an order the buyer never paid is never asked about', async () => {
    const store = new SupporterStore(storePath);
    await store.recordCreated({ orderId: ORDER, reference: 'ref-9', recipient: VIEWER, amountCents: 500 });
    expect((await run(Date.now() + DAY)).checked).toBe(0);
    expect(requests).toEqual([]);
  });

  it('an order PayPal does not know is skipped until its next turn', async () => {
    const store = new SupporterStore(storePath);
    await pendingOrder(store);
    expect(await run(Date.now() + 11 * MINUTE)).toMatchObject({ checked: 1, granted: [], failed: false });
    expect((await run(Date.now() + 12 * MINUTE)).checked).toBe(0);
  });
});

describe('the background checks', () => {
  it('are off under tests and with GXUFY_PAYPAL_RECHECK=off', () => {
    expect(payPalRecheckEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
    expect(payPalRecheckEnabled({ NODE_ENV: 'production', GXUFY_PAYPAL_RECHECK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(payPalRecheckEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(startPayPalRechecks({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('start one timer per server process, and say so', () => {
    vi.useFakeTimers();
    try {
      expect(payPalRechecksRunning()).toBe(false);
      expect(startPayPalRechecks({ NODE_ENV: 'production', GXUFY_PAYPAL_RECHECK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
      expect(payPalRechecksRunning()).toBe(false);
      expect(startPayPalRechecks({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
      expect(startPayPalRechecks({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      expect(payPalRechecksRunning()).toBe(true);
    } finally {
      __resetPayPalRecheckForTests();
      vi.useRealTimers();
    }
  });

  it('ask nothing while checkout is off, or while this copy is held or draining in a deploy', async () => {
    const store = new SupporterStore(storePath);
    await paidOrder(store, 'ORDER00001', 'CAPTURE0001');
    captureReplies.CAPTURE0001 = captureBody('CAPTURE0001', 'REFUNDED');
    const options = { now: () => Date.now() + 11 * MINUTE, gapMs: 0, log: () => undefined };

    expect(await payPalRecheckTick({ ...process.env, PAYPAL_CLIENT_ID: '' }, options)).toBeNull();

    const hold = path.join(dir, 'hold');
    writeFileSync(hold, '');
    vi.stubEnv('FLOSSCHAT_HOLD_FILE', hold);
    expect(await payPalRecheckTick(process.env, options)).toBeNull();
    vi.stubEnv('FLOSSCHAT_HOLD_FILE', '');

    const drain = path.join(dir, 'drain');
    writeFileSync(drain, '');
    const later = new Date(Date.now() + 1_000);
    utimesSync(drain, later, later);
    vi.stubEnv('FLOSSCHAT_DRAIN_FILE', drain);
    __resetDrainForTests();
    expect(await payPalRecheckTick(process.env, options)).toBeNull();
    vi.stubEnv('FLOSSCHAT_DRAIN_FILE', '');
    __resetDrainForTests();

    expect(requests).toEqual([]);
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await payPalRecheckTick(process.env, options)).toMatchObject({ reversed: ['ORDER00001'] });
    expect(await store.supporterIds()).toEqual([]);
  });
});
