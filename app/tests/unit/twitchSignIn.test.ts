/* Sign in with Twitch, the session cookie, and wearing / taking off the
 * FlossChat badge. Twitch and PayPal are faked; the supporter store is a real
 * file in a temp folder. */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loginHandler, { __resetSignInLimitForTests } from '@/api/auth/twitch/login';
import callbackHandler, { __resetCallbackLimitForTests } from '@/api/twitch/oauth/callback';
import logoutHandler from '@/api/auth/logout';
import meHandler from '@/api/auth/me';
import wearHandler, { __resetWearLimitForTests } from '@/api/badges/wear';
import versionHandler from '@/api/twitch/gxufy-badges-version';
import checkoutHandler, { __resetSupportCheckoutLimitForTests } from '@/api/support/checkout';
import {
  isSameOriginRequest,
  readSession,
  safeNextPath,
  sessionSecret,
  writeSession,
} from '@/lib/server/session';
import { authorizeUrl, signInWithCode, twitchOAuthConfig } from '@/lib/server/twitchOAuth';
import { SupporterStore, __closeSupporterStoresForTests } from '@/lib/server/supporterStore';
import { __resetGxufyBadgesCacheForTests, getGxufyBadges, ownsSupporterBadge } from '@/lib/server/gxufyBadges';
import { __resetPayPalForTests } from '@/lib/server/paypal';

const SECRET = 'x'.repeat(40);
const OWNER_ID = '204219574';
let dir = '';
let storePath = '';

type Result = { status: number; body: any; headers: Record<string, unknown>; location?: string };

function makeRes() {
  const result: Result = { status: 200, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { result.headers[name.toLowerCase()] = value; return this; },
    getHeader(name: string) { return result.headers[name.toLowerCase()]; },
    status(code: number) { result.status = code; return this; },
    json(value: unknown) { result.body = value; return this; },
    end() { return this; },
    redirect(code: number, url: string) { result.status = code; result.location = url; return this; },
  } as unknown as ApiResponse;
  return { res, result };
}

function cookiesFrom(result: Result): string[] {
  const value = result.headers['set-cookie'];
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}

/** The `name=value` pairs a browser would send back. */
function cookieHeader(result: Result): string {
  return cookiesFrom(result)
    .map((c) => c.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

async function call(
  handler: (req: ApiRequest, res: ApiResponse) => unknown,
  init: { method?: string; query?: Record<string, string>; body?: unknown; cookie?: string; origin?: string } = {},
) {
  const { res, result } = makeRes();
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  const req = {
    method: init.method ?? 'GET',
    query: init.query ?? {},
    body: init.body,
    headers,
    socket: { remoteAddress: '203.0.113.40' },
  } as unknown as ApiRequest;
  await handler(req, res);
  return result;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const revoked: string[] = [];
function twitchFetch(user: Record<string, unknown> = { id: '555', login: 'viewer', display_name: 'Viewer', profile_image_url: 'https://static-cdn.jtvnw.net/a.png' }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://id.twitch.tv/oauth2/token') {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('code') !== 'goodcode1234') return json({ message: 'bad code' }, 400);
      return json({ access_token: 'user-token-abc' });
    }
    if (url === 'https://api.twitch.tv/helix/users') return json({ data: [user] });
    if (url === 'https://id.twitch.tv/oauth2/revoke') {
      revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
}

async function signedInCookie(user = { id: '555', login: 'viewer', displayName: 'Viewer' }): Promise<string> {
  const { res, result } = makeRes();
  writeSession(res, user);
  return cookieHeader(result);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-signin-'));
  storePath = path.join(dir, 'supporters.db');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('GXUFY_SUPPORT_PAGE_ENABLED', '1');
  vi.stubEnv('TWITCH_CLIENT_ID', 'client-id');
  vi.stubEnv('TWITCH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('FLOSSCHAT_SESSION_SECRET', SECRET);
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', storePath);
  __resetSignInLimitForTests();
  __resetCallbackLimitForTests();
  __resetWearLimitForTests();
  __resetGxufyBadgesCacheForTests();
  revoked.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('session cookie', () => {
  it('round-trips the account and rejects tampering, expiry and other keys', async () => {
    const cookie = await signedInCookie();
    const req = { headers: { cookie } } as unknown as ApiRequest;
    expect(readSession(req)).toEqual({ id: '555', login: 'viewer', displayName: 'Viewer' });

    const [name, value] = cookie.split('=');
    const [body, mac] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ id: OWNER_ID, login: 'gxufy', displayName: 'Gxufy', exp: Date.now() + 1e9 })).toString('base64url');
    expect(readSession({ headers: { cookie: `${name}=${forged}.${mac}` } } as unknown as ApiRequest)).toBeNull();
    expect(readSession({ headers: { cookie: `${name}=${body}.AAAA` } } as unknown as ApiRequest)).toBeNull();
    expect(readSession(req, process.env, Date.now() + 31 * 24 * 3600 * 1000)).toBeNull();
    vi.stubEnv('FLOSSCHAT_SESSION_SECRET', 'y'.repeat(40));
    expect(readSession(req)).toBeNull();
  });

  it('is off in production without a long enough key, and makes a dev key when unset', () => {
    expect(sessionSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(sessionSecret({ NODE_ENV: 'production', FLOSSCHAT_SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toBeNull();
    const dev = sessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(dev).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(dev);
  });

  it('uses Secure __Host- cookies outside dev', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { res, result } = makeRes();
    writeSession(res, { id: '1', login: 'a_b', displayName: 'A' });
    const [cookie] = cookiesFrom(result);
    expect(cookie).toMatch(/^__Host-fc_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('only returns to same-site paths after sign-in', () => {
    expect(safeNextPath('/support')).toBe('/support');
    expect(safeNextPath('/badges?x=1')).toBe('/badges?x=1');
    expect(safeNextPath('//evil.example')).toBe('/badges');
    expect(safeNextPath('https://evil.example')).toBe('/badges');
    expect(safeNextPath('/\\evil.example')).toBe('/badges');
    expect(safeNextPath(undefined)).toBe('/badges');
  });

  it('accepts state-changing requests only from our own origins', () => {
    const req = (origin?: string, host = 'localhost:3000') => ({ headers: { origin, host } }) as unknown as ApiRequest;
    expect(isSameOriginRequest(req('http://localhost:3000'))).toBe(true);
    expect(isSameOriginRequest(req('http://localhost:4000'))).toBe(false);
    expect(isSameOriginRequest(req('https://flosschat.app'))).toBe(true);
    expect(isSameOriginRequest(req('https://gxufy.com'))).toBe(true);
    expect(isSameOriginRequest(req('https://evil.example'))).toBe(false);
    expect(isSameOriginRequest(req(undefined))).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isSameOriginRequest(req('http://localhost:3000'))).toBe(false);
  });
});

describe('Twitch OAuth', () => {
  it('asks Twitch for no scopes', () => {
    const url = new URL(authorizeUrl({ clientId: 'cid', clientSecret: 's' }, 'http://localhost:3000/api/twitch/oauth/callback', 'st'));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('reads the account once and revokes the token', async () => {
    const fetcher = twitchFetch();
    const user = await signInWithCode({ clientId: 'cid', clientSecret: 's' }, 'goodcode1234', 'http://x/cb', fetcher as unknown as typeof fetch);
    expect(user).toEqual({ id: '555', login: 'viewer', displayName: 'Viewer', avatarUrl: 'https://static-cdn.jtvnw.net/a.png' });
    await vi.waitFor(() => expect(revoked).toEqual(['user-token-abc']));
  });

  it('drops an avatar that is not on the Twitch CDN and rejects odd accounts', async () => {
    const odd = twitchFetch({ id: '7', login: 'ok_name', display_name: 'Ok', profile_image_url: 'https://evil.example/a.png' });
    const user = await signInWithCode({ clientId: 'c', clientSecret: 's' }, 'goodcode1234', 'http://x/cb', odd as unknown as typeof fetch);
    expect(user.avatarUrl).toBeUndefined();
    const bad = twitchFetch({ id: 'abc', login: 'Bad Name' });
    await expect(signInWithCode({ clientId: 'c', clientSecret: 's' }, 'goodcode1234', 'http://x/cb', bad as unknown as typeof fetch)).rejects.toThrow();
  });

  it('is off unless the support page, Twitch keys and a session key are all there', () => {
    expect(twitchOAuthConfig()).not.toBeNull();
    vi.stubEnv('TWITCH_CLIENT_SECRET', '');
    expect(twitchOAuthConfig()).toBeNull();
  });
});

describe('sign-in routes', () => {
  it('login -> Twitch -> callback signs the visitor in and returns them', async () => {
    const login = await call(loginHandler, { query: { next: '/support' } });
    expect(login.status).toBe(302);
    const authorize = new URL(login.location!);
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/twitch/oauth/callback');
    const state = authorize.searchParams.get('state')!;

    vi.stubGlobal('fetch', twitchFetch());
    const back = await call(callbackHandler, { query: { code: 'goodcode1234', state }, cookie: cookieHeader(login) });
    expect(back.status).toBe(302);
    expect(back.location).toBe('/support');
    const session = cookieHeader(back);
    expect(readSession({ headers: { cookie: session } } as unknown as ApiRequest)?.login).toBe('viewer');

    const me = await call(meHandler, { cookie: session });
    expect(me.body.user.login).toBe('viewer');
    /* No FlossChat badges yet: every tier is open at its full price. */
    expect(me.body.badges).toEqual([]);
    expect(me.body.standing).toEqual({ tier: null, founder: false, owner: false, prices: { supporter: 500, suvy: 1000, 'top-suvy': 2000 } });
  });

  it('refuses a callback whose state does not match the cookie', async () => {
    const login = await call(loginHandler);
    vi.stubGlobal('fetch', twitchFetch());
    const back = await call(callbackHandler, { query: { code: 'goodcode1234', state: 'not-the-state' }, cookie: cookieHeader(login) });
    expect(back.location).toBe('/badges?signin=failed');
    expect(cookieHeader(back)).toBe('');
  });

  it('sends a cancelled Twitch sign-in back with a note', async () => {
    const login = await call(loginHandler, { query: { next: '/badges' } });
    const state = new URL(login.location!).searchParams.get('state')!;
    const back = await call(callbackHandler, { query: { error: 'access_denied', state }, cookie: cookieHeader(login) });
    expect(back.location).toBe('/badges?signin=cancelled');
  });

  it('logs which step of a failed sign-in broke, never the code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const login = await call(loginHandler, { query: { next: '/support' } });
    const state = new URL(login.location!).searchParams.get('state')!;
    vi.stubGlobal('fetch', twitchFetch());
    const back = await call(callbackHandler, { query: { code: 'wrongcode1234', state }, cookie: cookieHeader(login) });
    expect(back.location).toBe('/support?signin=failed');
    expect(warn).toHaveBeenCalledWith('[twitch sign-in] failed: token exchange failed: bad code (HTTP 400)');

    const stale = await call(callbackHandler, { query: { code: 'goodcode1234', state: 'old-state' } });
    expect(stale.location).toBe('/badges?signin=failed');
    expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/^\[twitch sign-in\] failed: the sign-in state did not match/);

    const logged = warn.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).not.toContain('wrongcode1234');
    expect(logged).not.toContain('goodcode1234');
    expect(logged).not.toContain('client-secret');
  });

  it('logs a cancelled sign-in with only Twitch’s short reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const login = await call(loginHandler, { query: { next: '/support' } });
    const state = new URL(login.location!).searchParams.get('state')!;
    await call(callbackHandler, { query: { error: 'access_denied<script>', state }, cookie: cookieHeader(login) });
    expect(warn).toHaveBeenCalledWith('[twitch sign-in] cancelled on Twitch (access_deniedscript)');
  });

  it('logout clears the cookie, only from our own pages', async () => {
    expect((await call(logoutHandler, { method: 'POST' })).status).toBe(403);
    const out = await call(logoutHandler, { method: 'POST', origin: 'http://localhost:3000' });
    expect(out.status).toBe(204);
    expect(cookiesFrom(out)[0]).toContain('Max-Age=0');
  });

  it('in production, sign-in always starts on the canonical domain', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const legacy = await call(loginHandler, { query: { next: '/support' } });
    expect(legacy.status).toBe(302);
    expect(legacy.location).toBe('https://flosschat.app/api/auth/twitch/login?next=%2Fsupport');
    expect(cookiesFrom(legacy)).toEqual([]);
  });

  it('every route is hidden while sign-in is not set up', async () => {
    vi.stubEnv('TWITCH_CLIENT_ID', '');
    expect((await call(loginHandler)).status).toBe(404);
    expect((await call(meHandler)).status).toBe(404);
    expect((await call(wearHandler, { method: 'POST' })).status).toBe(404);
  });
});

describe('wearing the FlossChat badges', () => {
  const holders = async (store: SupporterStore, id: string) =>
    Object.fromEntries((await getGxufyBadges(store)).map((badge) => [badge.id, badge.userIds])) as Record<string, string[]>;

  it('lets a holder take their badges off and put them back, and the badge list follows', async () => {
    const store = new SupporterStore(storePath);
    await store.giveBadge({ id: '123', login: 'viewer', displayName: 'Viewer' }, new Date(), 'suvy');
    const cookie = await signedInCookie({ id: '123', login: 'viewer', displayName: 'Viewer' });
    const first = (await call(versionHandler)).body;
    expect(first.live).toBe(true);
    const v1 = first.v;
    expect((await holders(store, '123')).suvy).toContain('123');
    /* Suvy keeps the tier below it, Sanctioned, to wear instead. */
    expect((await call(meHandler, { cookie })).body.badges).toEqual([
      { id: 'suvy', title: 'Suvy', url: '/badges/gxufy/suvy-hand.webp', owned: true, worn: true },
      { id: 'supporter', title: 'Sanctioned', url: '/badges/gxufy/supporter-hand.webp', owned: true, worn: false },
    ]);

    const off = await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie, body: { badgeId: 'suvy', worn: false } });
    expect(off.status).toBe(200);
    expect((await holders(store, '123')).suvy).not.toContain('123');
    expect(await ownsSupporterBadge('123', store)).toBe(true);
    const v2 = (await call(versionHandler)).body.v;
    expect(v2).not.toBe(v1);
    expect((await call(meHandler, { cookie })).body.badges[0]).toMatchObject({ owned: true, worn: false });

    await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie, body: { badgeId: 'suvy', worn: true } });
    expect((await holders(store, '123')).suvy).toContain('123');
    expect((await call(versionHandler)).body.v).toBe(v1);
  });

  it('one badge at a time: wearing another swaps it, taking it off shows none', async () => {
    const FAN = { id: '777', login: 'fan', displayName: 'Fan' };
    const store = new SupporterStore(storePath);
    await store.giveBadge(FAN, new Date(), 'suvy');
    const cookie = await signedInCookie(FAN);
    const wear = (badgeId: string, worn: boolean) =>
      call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie, body: { badgeId, worn } });
    const worn = async () => (await call(meHandler, { cookie })).body.badges.map((b: { id: string; worn: boolean }) => [b.id, b.worn]);
    /* Nothing picked yet: their tier shows first. */
    expect(await worn()).toEqual([['suvy', true], ['supporter', false]]);
    expect((await holders(store, FAN.id)).suvy).toEqual([FAN.id]);

    /* The tier below theirs can be worn instead. */
    expect((await wear('supporter', true)).body).toEqual({ worn: true, badgeId: 'supporter' });
    expect(await worn()).toEqual([['suvy', false], ['supporter', true]]);
    expect(await holders(store, FAN.id)).toMatchObject({ suvy: [], supporter: [FAN.id] });

    expect((await wear('supporter', false)).status).toBe(200);
    expect(await worn()).toEqual([['suvy', false], ['supporter', false]]);
    expect(await holders(store, FAN.id)).toMatchObject({ suvy: [], supporter: [] });

    await wear('suvy', true);
    expect(await worn()).toEqual([['suvy', true], ['supporter', false]]);
    /* A badge they don't hold can't be worn. */
    expect((await wear('owner', true)).status).toBe(403);
    expect((await wear('founder', true)).status).toBe(403);
    expect((await wear('top-suvy', true)).status).toBe(403);
  });

  it('the owner account holds every badge, free, and wears any one of them', async () => {
    const store = new SupporterStore(storePath);
    const cookie = await signedInCookie({ id: OWNER_ID, login: 'gxufy', displayName: 'Gxufy' });
    const wear = (badgeId: string, worn: boolean) =>
      call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie, body: { badgeId, worn } });
    const me = async () => (await call(meHandler, { cookie })).body;
    /* Nothing paid or given: all five, Owner shown first, and nothing left to buy. */
    expect((await me()).badges.map((b: { id: string; worn: boolean }) => [b.id, b.worn])).toEqual([
      ['owner', true], ['founder', false], ['top-suvy', false], ['suvy', false], ['supporter', false],
    ]);
    expect((await me()).standing).toEqual({
      tier: 'top-suvy', founder: true, owner: true, prices: { supporter: null, suvy: null, 'top-suvy': null },
    });

    for (const badgeId of ['founder', 'top-suvy', 'suvy', 'supporter', 'owner']) {
      expect((await wear(badgeId, true)).status).toBe(200);
      expect((await holders(store, OWNER_ID))[badgeId]).toEqual([OWNER_ID]);
    }
    expect((await wear('owner', false)).status).toBe(200);
    expect(Object.values(await holders(store, OWNER_ID)).flat()).not.toContain(OWNER_ID);
  });

  it('refuses accounts without badges, signed-out visitors, other sites and unknown badges', async () => {
    const store = new SupporterStore(storePath);
    await store.giveBadge({ id: OWNER_ID, login: 'gxufy', displayName: 'Gxufy' });
    const viewer = await signedInCookie();
    const holder = await signedInCookie({ id: OWNER_ID, login: 'gxufy', displayName: 'Gxufy' });
    const body = { badgeId: 'supporter', worn: false };
    expect((await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie: viewer, body })).status).toBe(403);
    expect((await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', body })).status).toBe(401);
    expect((await call(wearHandler, { method: 'POST', origin: 'https://evil.example', cookie: holder, body })).status).toBe(403);
    expect((await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie: holder, body: { badgeId: 'other', worn: false } })).status).toBe(400);
    expect((await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie: viewer, body: { badgeId: 'owner', worn: true } })).status).toBe(403);
    expect((await call(wearHandler, { method: 'POST', origin: 'http://localhost:3000', cookie: holder, body: { badgeId: 'supporter', worn: 'no' } })).status).toBe(400);
  });
});

describe('checkout for yourself', () => {
  it('needs a signed-in session and never takes the recipient from the body', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-client');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'sandbox-secret');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    __resetPayPalForTests();
    __resetSupportCheckoutLimitForTests();
    let created: any = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 't', expires_in: 3600 });
      if (url.endsWith('/v2/checkout/orders')) {
        created = JSON.parse(String(init?.body));
        return json({ id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' }] }, 201);
      }
      throw new Error(`unexpected ${url}`);
    }));

    const signedOut = await call(checkoutHandler, { method: 'POST', body: { forSelf: true } });
    expect(signedOut.status).toBe(401);

    const cookie = await signedInCookie();
    const ok = await call(checkoutHandler, { method: 'POST', cookie, body: { forSelf: true, login: 'someoneelse' } });
    expect(ok.status).toBe(200);
    expect(created.purchase_units[0].custom_id).toBe('twitch:555');
    const store = new SupporterStore(storePath);
    expect((await store.getOrder('5O190127TN364715T'))?.recipient).toEqual({ id: '555', login: 'viewer', displayName: 'Viewer' });
  });
});
