import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once as onceIn, serve, send, type Answer, type Call, type Loader } from './routeServer.ts';

/*
 * Twitch sign-in: the status, headers, cookies and body of each request, over
 * real HTTP through apiRoute. The snapshots are what the Next.js app answered
 * (this app was checked against it, request for request, before it was
 * retired). The clock is held still so the signed cookies stay the same; the
 * OAuth state is random, so the sign-in starts are snapshotted with it blanked
 * and checked on their own.
 */

const ROUTES = {
	me: { path: '/api/auth/me', load: () => import('@/api/auth/me') },
	logout: { path: '/api/auth/logout', load: () => import('@/api/auth/logout') },
	login: { path: '/api/auth/twitch/login', load: () => import('@/api/auth/twitch/login') },
	callback: { path: '/api/twitch/oauth/callback', load: () => import('@/api/twitch/oauth/callback') },
	wear: { path: '/api/badges/wear', load: () => import('@/api/badges/wear') }
} satisfies Record<string, { path: string; load: Loader }>;
type RouteName = keyof typeof ROUTES;

const storeDir = mkdtempSync(path.join(tmpdir(), 'fc-signin-store-'));
/* Made-up keys (Twitch is stubbed); a supporter store of its own. */
const ENV = {
	GXUFY_SUPPORT_PAGE_ENABLED: '1',
	TWITCH_CLIENT_ID: 'parity-client-id',
	TWITCH_CLIENT_SECRET: 'parity-client-secret',
	FLOSSCHAT_SESSION_SECRET: 'parity-session-secret-0123456789abcdef',
	GXUFY_SUPPORTER_STORE_PATH: path.join(storeDir, 'supporters.db'),
	GXUFY_SUPPORTER_STORE_BACKUPS: 'off'
};
const NOW = Date.parse('2026-11-26T02:00:00Z');
const SITE = 'https://flosschat.app';
const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const VIEWER = { id: '12345', login: 'someviewer', displayName: 'SomeViewer' };
const CALLBACK_URI = `${SITE}/api/twitch/oauth/callback`;

function once(name: RouteName, call: Omit<Call, 'path'> & { query?: string }): Promise<Answer> {
	const { query = '', ...rest } = call;
	return onceIn(ROUTES[name].load, { ...rest, path: ROUTES[name].path + query });
}

/* One request, with Twitch answering as given. */
async function ask(name: RouteName, call: Omit<Call, 'path'> & { query?: string }, twitchAnswers = twitch()): Promise<Answer> {
	vi.stubGlobal('fetch', twitchAnswers());
	return once(name, call);
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type TwitchStep = 'token' | 'users';
/* Twitch's token, user and revoke endpoints; a step can be swapped for a failure. */
function twitch(overrides: Partial<Record<TwitchStep, () => Response | Promise<Response>>> = {}) {
	return () =>
		vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
			const url = String(input);
			if (url === 'https://id.twitch.tv/oauth2/token') return (await overrides.token?.()) ?? json({ access_token: 'parity-access-token' });
			if (url === 'https://api.twitch.tv/helix/users') {
				return (
					(await overrides.users?.()) ??
					json({ data: [{ id: OWNER.id, login: OWNER.login, display_name: OWNER.displayName, profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/gxufy.png' }] })
				);
			}
			if (url === 'https://id.twitch.tv/oauth2/revoke') return new Response(null, { status: 200 });
			throw new TypeError(`unexpected fetch ${url}`);
		});
}

/* Cookies made the way the routes make them (same key, same clock). */
function cookieJar() {
	let list: string[] = [];
	return { cookies: () => list, getHeader: () => list, setHeader: (_name: string, value: string[]) => void (list = value) };
}
async function sessionCookie(user: { id: string; login: string; displayName: string }, now = NOW): Promise<string> {
	const { writeSession } = await import('@/lib/server/session');
	const jar = cookieJar();
	expect(writeSession(jar as never, user, process.env, now)).toBe(true);
	return jar.cookies()[0]!.split(';')[0]!;
}
async function stateCookie(next = '/support', now = NOW): Promise<{ state: string; cookie: string }> {
	const { writeOAuthState } = await import('@/lib/server/session');
	const jar = cookieJar();
	const state = writeOAuthState(jar as never, next, process.env, now)!;
	return { state, cookie: jar.cookies()[0]!.split(';')[0]! };
}
const payloadOf = (cookie: string) =>
	JSON.parse(Buffer.from(cookie.slice(cookie.indexOf('=') + 1).split('.')[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;

/* The sign-in start with its random state blanked (each is checked on its own). */
function withoutState(answer: Answer): Answer {
	const blank = (text: string) => text.replace(/state=[A-Za-z0-9_-]{32}/g, 'state=STATE');
	return {
		...answer,
		headers: { ...answer.headers, ...(answer.headers.location ? { location: blank(answer.headers.location) } : {}) },
		cookies: answer.cookies.map((cookie) => cookie.replace(/^(__Host-fc_oauth=)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, '$1TOKEN')),
		body: blank(answer.body),
		sha256: ''
	};
}

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

describe('/api/auth/me', () => {
	const cases: Array<[string, () => Promise<Record<string, string>>]> = [
		['signed out', async () => ({})],
		['the owner, signed in', async () => ({ Cookie: await sessionCookie(OWNER) })],
		['a viewer holding no badge', async () => ({ Cookie: await sessionCookie(VIEWER) })],
		['a cookie with a changed signature', async () => ({ Cookie: (await sessionCookie(OWNER)).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })],
		['an expired session', async () => ({ Cookie: await sessionCookie(OWNER, NOW - 31 * 24 * 60 * 60 * 1000) })],
		['the session among other cookies', async () => ({ Cookie: `a=1; ${await sessionCookie(VIEWER)}; b=2` })]
	];
	for (const [label, headers] of cases) {
		it(`answers ${label}`, async () => {
			const mine = await ask('me', { headers: await headers() });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(200);
			expect(mine.headers['cache-control']).toBe('private, no-store');
		});
	}

	it('knows the owner as the owner, with the Owner badge', async () => {
		const mine = await ask('me', { headers: { Cookie: await sessionCookie(OWNER) } });
		const body = JSON.parse(mine.body) as { user: { id: string }; owner?: boolean; badges: Array<{ id: string }> };
		expect(body.user.id).toBe(OWNER.id);
		expect(body.owner).toBe(true);
		expect(body.badges.map((badge) => badge.id)).toContain('owner');
	});

	for (const method of ['POST', 'HEAD', 'DELETE']) {
		it(`refuses ${method}`, async () => {
			const mine = await ask('me', { method });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(405);
		});
	}

	it('is off (404) without a session key', async () => {
		vi.stubEnv('FLOSSCHAT_SESSION_SECRET', '');
		const mine = await ask('me', {});
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(404);
	});
});

describe('/api/auth/logout', () => {
	const cases: Array<[string, Omit<Call, 'path'>, number]> = [
		['from our own page', { method: 'POST', headers: { Origin: SITE } }, 204],
		['from gxufy.com', { method: 'POST', headers: { Origin: 'https://gxufy.com' } }, 204],
		['with no Origin', { method: 'POST' }, 403],
		['from another site', { method: 'POST', headers: { Origin: 'https://evil.example' } }, 403],
		['as a GET', { method: 'GET' }, 405]
	];
	for (const [label, call, status] of cases) {
		it(`answers ${label}`, async () => {
			const mine = await ask('logout', { ...call, headers: { ...call.headers, Cookie: await sessionCookie(OWNER) } });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(status);
		});
	}

	it('clears the session cookie', async () => {
		const mine = await ask('logout', { method: 'POST', headers: { Origin: SITE } });
		expect(mine.cookies).toEqual(['__Host-fc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure']);
	});
});

describe('/api/auth/twitch/login', () => {
	it('sends the visitor to Twitch with a state cookie', async () => {
		const mine = await ask('login', { query: '?next=/support', headers: { Host: 'flosschat.app' } });
		expect(withoutState(mine)).toMatchSnapshot();
		expect(mine.status).toBe(302);
		const location = new URL(mine.headers.location!);
		expect(location.origin + location.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
		expect(location.searchParams.get('client_id')).toBe(ENV.TWITCH_CLIENT_ID);
		expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK_URI);
		/* The state in the link is the one signed into the cookie. */
		expect(mine.cookies).toHaveLength(1);
		const payload = payloadOf(mine.cookies[0]!.split(';')[0]!);
		expect(payload).toEqual({ state: location.searchParams.get('state'), next: '/support', exp: NOW + 600_000 });
		expect(mine.cookies[0]).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
		/* A new state each time. */
		const again = await ask('login', { query: '?next=/support', headers: { Host: 'flosschat.app' } });
		expect(new URL(again.headers.location!).searchParams.get('state')).not.toBe(location.searchParams.get('state'));
	});

	it('keeps only same-site return paths', async () => {
		for (const next of ['//evil.example/x', 'https://evil.example', '/badges\\x', '']) {
			const mine = await ask('login', { query: `?next=${encodeURIComponent(next)}`, headers: { Host: 'flosschat.app' } });
			expect(withoutState(mine)).toMatchSnapshot();
			expect(payloadOf(mine.cookies[0]!.split(';')[0]!).next).toBe('/badges');
		}
	});

	for (const host of ['multichat-gxufy.com', 'gxufy.com', 'www.flosschat.app']) {
		it(`starts over on flosschat.app from ${host},`, async () => {
			const mine = await ask('login', { query: '?next=/support', headers: { Host: host } });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(302);
			expect(mine.headers.location).toBe(`${SITE}/api/auth/twitch/login?next=%2Fsupport`);
			expect(mine.cookies).toEqual([]);
		});
	}

	it('refuses POST', async () => {
		const mine = await ask('login', { method: 'POST', headers: { Host: 'flosschat.app', Origin: SITE } });
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(405);
	});

	it('is off (404) without the Twitch app keys', async () => {
		vi.stubEnv('TWITCH_CLIENT_SECRET', '');
		const mine = await ask('login', { headers: { Host: 'flosschat.app' } });
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(404);
	});

	it('limits sign-in starts per visitor (20 in 10 minutes)', async () => {
		const server = await serve(ROUTES.login.load);
		try {
			const statuses: number[] = [];
			for (let i = 0; i < 21; i++) statuses.push((await send(server, { path: ROUTES.login.path, headers: { Host: 'flosschat.app' } })).status);
			expect(statuses.slice(0, 20).every((status) => status === 302)).toBe(true);
			expect(statuses[20]).toBe(429);
		} finally {
			await server.close();
		}
	});
});

describe('/api/twitch/oauth/callback', () => {
	const signIn = async (tweak: { state?: string; cookie?: string | null; query?: string } = {}) => {
		const { state, cookie } = await stateCookie('/support?tier=x');
		const query = tweak.query ?? `?code=abcdefghij0123456789&state=${tweak.state ?? state}`;
		const headers: Record<string, string> = tweak.cookie === null ? {} : { Cookie: tweak.cookie ?? cookie };
		return { query, headers };
	};

	it('signs the visitor in and returns to their page,', async () => {
		const mine = await ask('callback', await signIn());
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(302);
		expect(mine.headers.location).toBe('/support?tier=x');
		/* The state cookie is used up, the session cookie set. */
		expect(mine.cookies[0]).toBe('__Host-fc_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
		const session = mine.cookies[1]!.split(';')[0]!;
		expect(session.startsWith('__Host-fc_session=')).toBe(true);
		expect(payloadOf(session)).toEqual({
			id: OWNER.id,
			login: OWNER.login,
			displayName: OWNER.displayName,
			avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/gxufy.png',
			exp: NOW + 30 * 24 * 60 * 60 * 1000
		});
	});

	it('swaps the code with the callback address and gives the token back', async () => {
		const fetcher = twitch()();
		vi.stubGlobal('fetch', fetcher);
		await once('callback', await signIn());
		const calls = fetcher.mock.calls.map(([input, init]) => [String(input), init as RequestInit | undefined] as const);
		const token = calls.find(([url]) => url === 'https://id.twitch.tv/oauth2/token')!;
		const body = new URLSearchParams(String(token[1]!.body));
		expect(Object.fromEntries(body)).toEqual({
			client_id: ENV.TWITCH_CLIENT_ID,
			client_secret: ENV.TWITCH_CLIENT_SECRET,
			code: 'abcdefghij0123456789',
			grant_type: 'authorization_code',
			redirect_uri: CALLBACK_URI
		});
		await vi.waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input) === 'https://id.twitch.tv/oauth2/revoke')).toBe(true));
	});

	const failures: Array<[string, () => Promise<Omit<Call, 'path'> & { query?: string }>, ReturnType<typeof twitch>?]> = [
		['a state that does not match', () => signIn({ state: 'x'.repeat(32) })],
		['no state cookie', () => signIn({ cookie: null })],
		['a state cookie with a changed signature', async () => signIn({ cookie: (await stateCookie()).cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })],
		['an expired state', async () => {
			const old = await stateCookie('/support', NOW - 11 * 60 * 1000);
			return { query: `?code=abcdefghij0123456789&state=${old.state}`, headers: { Cookie: old.cookie } };
		}],
		['the visitor cancelling on Twitch', async () => {
			const { state, cookie } = await stateCookie('/support');
			return { query: `?error=access_denied&state=${state}`, headers: { Cookie: cookie } };
		}],
		['a malformed code', async () => {
			const { state, cookie } = await stateCookie('/support');
			return { query: `?code=short&state=${state}`, headers: { Cookie: cookie } };
		}],
		['Twitch refusing the code', () => signIn(), twitch({ token: () => json({ message: 'Invalid authorization code' }, 400) })],
		['Twitch not answering', () => signIn(), twitch({ token: () => Promise.reject(new TypeError('fetch failed')) })],
		['an unexpected user answer', () => signIn(), twitch({ users: () => json({ data: [] }) })]
	];
	for (const [label, call, answers] of failures) {
		it(`sends the visitor back on ${label},`, async () => {
			const mine = await ask('callback', await call(), answers);
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(302);
			expect(mine.headers.location).toMatch(/[?&]signin=(failed|cancelled)$/);
			expect(mine.cookies.some((cookie) => cookie.startsWith('__Host-fc_session='))).toBe(false);
		});
	}

	it('logs one line for a failed sign-in', async () => {
		const warn = vi.mocked(console.warn);
		warn.mockClear();
		vi.stubGlobal('fetch', twitch({ token: () => json({ message: 'Invalid authorization code' }, 400) })());
		await once('callback', await signIn());
		expect(warn.mock.calls.map((args) => args.join(' '))).toEqual(['[twitch sign-in] failed: token exchange failed: Invalid authorization code (HTTP 400)']);
	});

	it('refuses POST', async () => {
		const mine = await ask('callback', { method: 'POST', ...(await signIn()) });
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(405);
	});
});

describe('/api/badges/wear', () => {
	const wear = (body: unknown, extra: Record<string, string> = {}) => ({
		method: 'POST',
		headers: { Origin: SITE, 'Content-Type': 'application/json', ...extra },
		body: JSON.stringify(body)
	});
	const cases: Array<[string, () => Promise<Omit<Call, 'path'>>, number]> = [
		['the owner wearing the Owner badge', async () => wear({ badgeId: 'owner', worn: true }, { Cookie: await sessionCookie(OWNER) }), 200],
		['the owner taking it off', async () => wear({ badgeId: 'owner', worn: false }, { Cookie: await sessionCookie(OWNER) }), 200],
		['a viewer wearing a badge they do not hold', async () => wear({ badgeId: 'founder', worn: true }, { Cookie: await sessionCookie(VIEWER) }), 403],
		['an unknown badge', async () => wear({ badgeId: 'nope', worn: true }, { Cookie: await sessionCookie(OWNER) }), 400],
		['a body that is not JSON', async () => ({ ...wear({}, { Cookie: await sessionCookie(OWNER) }), body: '{nope' }), 400],
		['no session', async () => wear({ badgeId: 'owner', worn: true }), 401],
		['no Origin', async () => {
			const call = wear({ badgeId: 'owner', worn: true }, { Cookie: await sessionCookie(OWNER) });
			const { Origin: _origin, ...headers } = call.headers;
			return { ...call, headers };
		}, 403],
		['another site', async () => wear({ badgeId: 'owner', worn: true }, { Cookie: await sessionCookie(OWNER), Origin: 'https://evil.example' }), 403],
		['a GET', async () => ({ method: 'GET', headers: { Cookie: await sessionCookie(OWNER) } }), 405]
	];
	for (const [label, call, status] of cases) {
		it(`answers ${label}`, async () => {
			const mine = await ask('wear', await call());
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(status);
		});
	}

	it('a badge worn or taken off shows in the visitor\'s own details', async () => {
		vi.stubGlobal('fetch', twitch()());
		const cookie = await sessionCookie(OWNER);
		await once('wear', wear({ badgeId: 'owner', worn: false }, { Cookie: cookie }));
		const off = JSON.parse((await once('me', { headers: { Cookie: cookie } })).body) as { badges: Array<{ id: string; worn: boolean }> };
		expect(off.badges.find((badge) => badge.id === 'owner')?.worn).toBe(false);
		await once('wear', wear({ badgeId: 'owner', worn: true }, { Cookie: cookie }));
		const on = JSON.parse((await once('me', { headers: { Cookie: cookie } })).body) as { badges: Array<{ id: string; worn: boolean }> };
		expect(on.badges.find((badge) => badge.id === 'owner')?.worn).toBe(true);
	});
});

describe('a whole sign-in', () => {
	it('starts, finishes, gives a working session and uses the state up', async () => {
		vi.stubGlobal('fetch', twitch()());
		const begun = await once('login', { query: '?next=/badges', headers: { Host: 'flosschat.app' } });
		const state = new URL(begun.headers.location!).searchParams.get('state')!;
		const stateCookieValue = begun.cookies[0]!.split(';')[0]!;
		const done = await once('callback', { query: `?code=abcdefghij0123456789&state=${state}`, headers: { Cookie: stateCookieValue } });
		expect(done.status).toBe(302);
		expect(done.headers.location).toBe('/badges');
		const session = done.cookies.find((cookie) => cookie.startsWith('__Host-fc_session='))!.split(';')[0]!;
		const me = JSON.parse((await once('me', { headers: { Cookie: session } })).body) as { user: { id: string } | null };
		expect(me.user?.id).toBe(OWNER.id);
		/* The same callback again fails. */
		const again = await once('callback', {
			query: `?code=abcdefghij0123456789&state=${state}`,
			headers: { Cookie: done.cookies[0]!.split(';')[0]! }
		});
		expect(again.headers.location).toBe('/badges?signin=failed');
	});
});
