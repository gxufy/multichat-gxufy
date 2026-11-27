/* Owner tools "Give a badge": the store's given list and the owner-only API. */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
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
vi.mock('@/api/twitch/support-user', () => ({
  resolveSupportTwitchUser: async (login: string) => {
    lookups.push(login);
    return twitchAccounts[login] ?? null;
  },
}));

import handler, { __resetGiveBadgeLimitForTests } from '@/api/badges/give';
import { SupporterStore, __closeSupporterStoresForTests, openSupporterStore } from '@/lib/server/supporterStore';
import { getGxufyHolders, heldBadgeIds, ownsSupporterBadge, supporterStanding, __resetGxufyBadgesCacheForTests } from '@/lib/server/gxufyBadges';
import { FOUNDER_LIMIT } from '@/lib/supporterTiers';

/** A completed $5 order for `id`, completed at `completedAt`. */
async function paid(store: SupporterStore, id: string, completedAt: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(completedAt));
  try {
    await store.recordCreated({ orderId: `O${id}`, reference: `r${id}`, recipient: { id, login: `fan${id}`, displayName: `Fan${id}` }, kind: 'gift', amountCents: 500 });
    await store.markCompleted(`O${id}`, `CAPTURE${id}`);
  } finally {
    vi.useRealTimers();
  }
}

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
  } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as ApiResponse;
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
    expect(await store.givenBadges()).toEqual([{ id: '777', login: 'renamed', displayName: 'Renamed', givenAt: '2026-11-18T10:00:00.000Z', tier: 'supporter' }]);

    /* Giving a tier: the same entry, now that tier. */
    const suvy = await store.giveBadge({ id: '777', login: 'renamed', displayName: 'Renamed' }, new Date('2026-11-20T10:00:00Z'), 'suvy');
    expect([suvy.givenAt, suvy.tier]).toEqual(['2026-11-18T10:00:00.000Z', 'suvy']);
    expect(await store.creditFor('777')).toBe(1000);

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

describe('given Founders in the store', () => {
  const FAN = { id: '777', login: 'testviewer', displayName: 'TestViewer' };

  it('hold a Founder spot in the order they were given, alongside paid ones, and only the Founder badge', async () => {
    const store = new SupporterStore(file);
    await paid(store, '100', '2026-11-20T10:00:00.000Z');
    await paid(store, '300', '2026-11-22T10:00:00.000Z');
    const before = await store.revision();
    const result = await store.giveFounder(FAN, FOUNDER_LIMIT, new Date('2026-11-21T10:00:00.000Z'));
    expect(result).toEqual({ status: 'given', founder: { ...FAN, givenAt: '2026-11-21T10:00:00.000Z' } });
    expect(await store.revision()).not.toBe(before);
    expect(await store.founderIds(FOUNDER_LIMIT)).toEqual(['100', '777', '300']);
    expect(await store.givenFounders()).toEqual([{ ...FAN, givenAt: '2026-11-21T10:00:00.000Z' }]);

    __resetGxufyBadgesCacheForTests();
    expect((await getGxufyHolders(store)).founder).toEqual(['100', '204219574', '300', '777']);
    const standing = await supporterStanding('777', store);
    expect([standing.tier, standing.founder]).toEqual([null, true]);
    expect(heldBadgeIds(standing)).toEqual(['founder']);
    expect(await ownsSupporterBadge('777', store)).toBe(true);
    /* No tier comes with it. */
    expect(await store.creditFor('777')).toBe(0);

    /* Giving again keeps its place and refreshes the name. */
    const again = await store.giveFounder({ ...FAN, login: 'renamed', displayName: 'Renamed' }, FOUNDER_LIMIT, new Date('2026-11-23T10:00:00.000Z'));
    expect(again).toEqual({ status: 'given', founder: { id: '777', login: 'renamed', displayName: 'Renamed', givenAt: '2026-11-21T10:00:00.000Z' } });

    /* Someone who is a Founder through a payment is left alone. */
    expect(await store.giveFounder({ id: '100', login: 'fan100', displayName: 'Fan100' }, FOUNDER_LIMIT)).toEqual({ status: 'already' });
    expect(await store.givenFounders()).toHaveLength(1);

    /* Taking back a given tier leaves the given Founder alone, and the other way round. */
    await store.giveBadge(FAN, new Date('2026-11-23T11:00:00.000Z'), 'suvy');
    expect(await store.takeBackGivenBadge('777')).toBe(true);
    expect(await store.founderIds(FOUNDER_LIMIT)).toContain('777');
    expect(await store.takeBackGivenFounder('777')).toBe(true);
    expect(await store.takeBackGivenFounder('777')).toBe(false);
    expect(await store.founderIds(FOUNDER_LIMIT)).toEqual(['100', '300']);
    expect(await ownsSupporterBadge('777', store)).toBe(false);
  });

  it('are refused once every spot is taken, and a spot opens again when one is taken back or refunded', async () => {
    const store = new SupporterStore(file);
    for (let n = 0; n < FOUNDER_LIMIT - 1; n += 1) await paid(store, String(1000 + n), `2026-11-20T10:${String(n).padStart(2, '0')}:00.000Z`);
    expect((await store.giveFounder(FAN, FOUNDER_LIMIT, new Date('2026-11-21T10:00:00.000Z'))).status).toBe('given');
    expect(await store.founderIds(FOUNDER_LIMIT)).toHaveLength(FOUNDER_LIMIT);

    const late = { id: '888', login: 'late', displayName: 'Late' };
    const revision = await store.revision();
    expect(await store.giveFounder(late, FOUNDER_LIMIT)).toEqual({ status: 'full' });
    expect(await store.revision()).toBe(revision);

    /* A paid supporter past the 25th waits in line behind the given one. */
    await paid(store, '2000', '2026-11-22T10:00:00.000Z');
    expect(await store.founderIds(FOUNDER_LIMIT)).not.toContain('2000');
    await store.takeBackGivenFounder('777');
    expect(await store.founderIds(FOUNDER_LIMIT)).toContain('2000');
    expect(await store.giveFounder(late, FOUNDER_LIMIT)).toEqual({ status: 'full' });

    await store.markReversed('CAPTURE1000');
    expect((await store.giveFounder(late, FOUNDER_LIMIT, new Date('2026-11-23T10:00:00.000Z'))).status).toBe('given');
    expect(await store.founderIds(FOUNDER_LIMIT)).toContain('888');
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

  it('gives a Founder by name, lists it with the spots left, and takes it back', async () => {
    sessionUser = OWNER;
    const given = await call('POST', { login: 'testviewer', tier: 'founder' });
    expect(given.statusCode).toBe(200);
    expect(given.body).toMatchObject({ founder: { id: '777', login: 'testviewer', displayName: 'TestViewer' }, founderSlotsLeft: FOUNDER_LIMIT - 1 });

    const list = await call('GET', undefined, null);
    expect(list.body).toEqual({ given: [], founders: [given.body.founder], founderSlotsLeft: FOUNDER_LIMIT - 1 });
    expect(await ownsSupporterBadge('777')).toBe(true);

    /* Giving it again changes nothing; the owner's account already has it. */
    expect((await call('POST', { login: 'testviewer', tier: 'founder' })).body.founder.givenAt).toBe(given.body.founder.givenAt);
    twitchAccounts.gxufy = OWNER;
    const self = await call('POST', { login: 'gxufy', tier: 'founder' });
    delete twitchAccounts.gxufy;
    expect([self.statusCode, self.body.error]).toEqual([409, 'That account already has every badge.']);

    /* A plain take-back is for given tiers; badge "founder" takes the Founder back. */
    expect((await call('POST', { takeBack: '777' })).body).toEqual({ takenBack: false });
    expect((await call('POST', { takeBack: '777', badge: 'other' })).statusCode).toBe(400);
    expect((await call('POST', { takeBack: '777', badge: 'founder' })).body).toEqual({ takenBack: true });
    expect((await call('GET', undefined, null)).body).toMatchObject({ founders: [], founderSlotsLeft: FOUNDER_LIMIT });
    expect(await ownsSupporterBadge('777')).toBe(false);
  });

  it('refuses a Founder once all spots are taken', async () => {
    sessionUser = OWNER;
    const store = openSupporterStore()!;
    for (let n = 0; n < FOUNDER_LIMIT; n += 1) await paid(store, String(1000 + n), `2026-11-20T10:${String(n).padStart(2, '0')}:00.000Z`);
    const full = await call('POST', { login: 'kaicenat', tier: 'founder' });
    expect([full.statusCode, full.body.error]).toEqual([409, `All ${FOUNDER_LIMIT} Founder spots are taken.`]);
    expect((await call('GET', undefined, null)).body).toMatchObject({ founders: [], founderSlotsLeft: 0 });
  });

  it('limits how fast changes can be made', async () => {
    sessionUser = OWNER;
    for (let i = 0; i < 30; i += 1) expect((await call('POST', { takeBack: '777' })).statusCode).toBe(200);
    expect((await call('POST', { takeBack: '777' })).statusCode).toBe(429);
  });
});
