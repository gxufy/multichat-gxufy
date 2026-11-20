/* Owner tools "Give a badge": the store's given list and the owner-only API. */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));
vi.mock('@/lib/server/twitchOAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/twitchOAuth')>()),
  signInReady: () => true,
}));
const twitchAccounts: Record<string, { id: string; login: string; displayName: string }> = {
  testviewer: { id: '777', login: 'testviewer', displayName: 'TestViewer' },
  kaicenat: { id: '641972806', login: 'kaicenat', displayName: 'KaiCenat' },
};
const lookups: string[] = [];
vi.mock('@/pages/api/twitch/support-user', () => ({
  resolveSupportTwitchUser: async (login: string) => {
    lookups.push(login);
    return twitchAccounts[login] ?? null;
  },
}));

import handler, { __resetGiveBadgeLimitForTests } from '@/pages/api/badges/give';
import { SupporterStore, __closeSupporterStoresForTests, openSupporterStore } from '@/lib/server/supporterStore';
import { ownsSupporterBadge } from '@/lib/server/gxufyBadges';

const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const SITE = 'http://localhost:3000';
let dir = '';
let file = '';

/** `origin: null` sends no Origin header, as a browser's same-site GET does. */
async function call(method: string, requestBody?: unknown, origin: string | null = SITE) {
  let statusCode = 200;
  let body: any;
  const req = {
    method,
    query: {},
    body: requestBody,
    headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) },
    socket: { remoteAddress: '203.0.113.9' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return { statusCode, body };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-give-'));
  file = path.join(dir, 'supporters.db');
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', file);
  vi.stubEnv('NODE_ENV', 'development');
  sessionUser = null;
  lookups.length = 0;
  __resetGiveBadgeLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('given badges in the store', () => {
  it('count as owning the badge, keep the first date, and come back off cleanly', async () => {
    const store = new SupporterStore(file);
    const before = await store.revision();
    const first = await store.giveBadge({ id: '777', login: 'testviewer', displayName: 'TestViewer' }, new Date('2026-11-18T10:00:00Z'));
    expect(first.givenAt).toBe('2026-11-18T10:00:00.000Z');
    expect(await store.revision()).not.toBe(before);
    expect(await store.supporterIds()).toEqual(['777']);
    expect(await ownsSupporterBadge('777', store)).toBe(true);

    /* Again, after a rename: same date, new name. */
    const again = await store.giveBadge({ id: '777', login: 'renamed', displayName: 'Renamed' }, new Date('2026-11-19T10:00:00Z'));
    expect(again.givenAt).toBe('2026-11-18T10:00:00.000Z');
    expect(await store.givenBadges()).toEqual([{ id: '777', login: 'renamed', displayName: 'Renamed', givenAt: '2026-11-18T10:00:00.000Z' }]);

    expect(await store.takeBackGivenBadge('777')).toBe(true);
    expect(await store.takeBackGivenBadge('777')).toBe(false);
    expect(await store.supporterIds()).toEqual([]);
    expect(await ownsSupporterBadge('777', store)).toBe(false);
  });

  it('never takes back a badge someone paid for', async () => {
    const store = new SupporterStore(file);
    const buyer = { id: '888', login: 'buyer', displayName: 'Buyer' };
    await store.recordCreated({ orderId: 'O1', reference: 'r', recipient: buyer, kind: 'self', amountCents: 500 });
    await store.markCompleted('O1', 'C1');
    await store.giveBadge(buyer);
    expect(await store.supporterIds()).toEqual(['888']);
    expect(await store.takeBackGivenBadge('888')).toBe(true);
    expect(await store.supporterIds()).toEqual(['888']);
    /* Nothing to take back for a paid-only badge. */
    expect(await store.takeBackGivenBadge('888')).toBe(false);
  });
});

describe('/api/badges/give', () => {
  it('is for the owner only, and changes only from our own pages', async () => {
    expect((await call('GET')).statusCode).toBe(403);
    expect((await call('POST', { login: 'testviewer' })).statusCode).toBe(403);
    sessionUser = { id: '555', login: 'someone', displayName: 'Someone' };
    expect((await call('GET')).statusCode).toBe(403);
    expect((await call('POST', { login: 'testviewer' })).statusCode).toBe(403);

    sessionUser = OWNER;
    expect((await call('POST', { login: 'testviewer' }, 'https://evil.example')).statusCode).toBe(403);
    expect((await call('POST', { login: 'testviewer' }, null)).statusCode).toBe(403);
    expect((await call('PUT', { login: 'testviewer' })).statusCode).toBe(405);
    expect(lookups).toEqual([]);
    expect(await openSupporterStore()!.supporterIds()).toEqual([]);
  });

  it('gives by Twitch name, lists, and takes back', async () => {
    sessionUser = OWNER;
    const given = await call('POST', { login: '@TestViewer' });
    expect(given.statusCode).toBe(200);
    expect(given.body.given).toMatchObject({ id: '777', login: 'testviewer', displayName: 'TestViewer' });
    expect(lookups).toEqual(['testviewer']);

    /* Reading the list needs only the owner's sign-in (browsers send no Origin on GET). */
    const list = await call('GET', undefined, null);
    expect(list.statusCode).toBe(200);
    expect(list.body.given).toEqual([given.body.given]);
    expect(await ownsSupporterBadge('777')).toBe(true);

    const back = await call('POST', { takeBack: '777' });
    expect(back.body).toEqual({ takenBack: true });
    expect((await call('GET', undefined, null)).body.given).toEqual([]);
    expect(await ownsSupporterBadge('777')).toBe(false);
  });

  it('refuses bad names, unknown accounts and bad ids', async () => {
    sessionUser = OWNER;
    expect((await call('POST', { login: '' })).statusCode).toBe(400);
    expect((await call('POST', { login: 'not a name!' })).statusCode).toBe(400);
    expect((await call('POST', {})).statusCode).toBe(400);
    const missing = await call('POST', { login: 'nobodyhere' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body.error).toBe('No Twitch account found.');
    expect((await call('POST', { takeBack: 'abc' })).statusCode).toBe(400);
    expect((await call('POST', { takeBack: 12 })).statusCode).toBe(400);
    expect(await openSupporterStore()!.supporterIds()).toEqual([]);
  });

  it('limits how fast changes can be made', async () => {
    sessionUser = OWNER;
    for (let i = 0; i < 30; i += 1) expect((await call('POST', { takeBack: '777' })).statusCode).toBe(200);
    expect((await call('POST', { takeBack: '777' })).statusCode).toBe(429);
  });
});
