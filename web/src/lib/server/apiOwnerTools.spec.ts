import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once, serve, send, type Answer, type Call, type Loader } from './routeServer.ts';

/*
 * The owner tools: overlay refresh (and the commands sent to overlays), giving
 * badges, and text to speech. Requests that change the supporter database run
 * as a sequence from an empty database. The snapshots are what the Next.js app
 * answered (this app was checked against it, request for request, before it
 * was retired). The clock is held still, so stamps and dates stay the same.
 */

/* TTS checks the Streamlabs audio host's addresses; answer with a public one. */
vi.mock('node:dns/promises', () => ({
	resolve4: async () => ['52.94.236.248'],
	resolve6: async () => {
		throw Object.assign(new Error('no AAAA'), { code: 'ENODATA' });
	}
}));

const ROUTES = {
	refresh: { path: '/api/overlay/refresh', load: () => import('@/api/overlay/refresh') },
	give: { path: '/api/badges/give', load: () => import('@/api/badges/give') },
	tts: { path: '/api/tts', load: () => import('@/api/tts') }
} satisfies Record<string, { path: string; load: Loader }>;
type RouteName = keyof typeof ROUTES;
type Step = { route: RouteName; call: Omit<Call, 'path'> & { query?: string } };

const storeDir = mkdtempSync(path.join(tmpdir(), 'fc-owner-tools-'));
let storeCount = 0;
const ENV = {
	GXUFY_SUPPORT_PAGE_ENABLED: '1',
	TWITCH_CLIENT_ID: 'parity-client-id',
	TWITCH_CLIENT_SECRET: 'parity-client-secret',
	FLOSSCHAT_SESSION_SECRET: 'parity-session-secret-0123456789abcdef',
	GXUFY_SUPPORTER_STORE_BACKUPS: 'off'
};
const NOW = Date.parse('2026-11-26T03:00:00Z');
const SITE = 'https://flosschat.app';
const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const VIEWER = { id: '12345', login: 'someviewer', displayName: 'SomeViewer' };
/* An MP3 frame header and every byte value, so any text conversion would show. */
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: 256 }, (_, i) => i)]);

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const audio = (bytes = AUDIO) => new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
/* Twitch's public account lookup: the owner, a viewer, or nobody. */
const twitchUsers: Upstream = (_url, init) => {
	const login = (JSON.parse(String(init?.body ?? '{}')) as { variables?: { login?: string } }).variables?.login;
	const user = login === OWNER.login ? OWNER : login === VIEWER.login ? VIEWER : null;
	return json({ data: { user: user && { id: user.id, login: user.login, displayName: user.displayName, profileImageURL: null } } });
};
function upstream(routes: Record<string, Upstream> = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		for (const [prefix, answer] of Object.entries({ 'https://gql.twitch.tv/gql': twitchUsers, ...routes })) {
			if (url.startsWith(prefix)) return answer(url, init);
		}
		throw new TypeError(`fetch failed: ${url}`);
	});
}

async function sessionCookie(user: { id: string; login: string; displayName: string }): Promise<string> {
	const { writeSession } = await import('@/lib/server/session');
	let list: string[] = [];
	const res = { getHeader: () => list, setHeader: (_name: string, value: string[]) => void (list = value) };
	expect(writeSession(res as never, user, process.env, NOW)).toBe(true);
	return list[0]!.split(';')[0]!;
}

/* The steps in order, from an empty database of their own. */
async function run(steps: Step[] | (() => Promise<Step[]>), fetches = upstream): Promise<Answer[]> {
	const answers: Answer[] = [];
	vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
	vi.stubGlobal('fetch', fetches());
	for (const { route, call } of typeof steps === 'function' ? await steps() : steps) {
		const { query = '', ...rest } = call;
		answers.push(await once(ROUTES[route].load, { ...rest, path: ROUTES[route].path + query }));
	}
	return answers;
}
async function ask(route: RouteName, call: Step['call'], fetches = upstream): Promise<Answer> {
	const [mine] = await run([{ route, call }], fetches);
	return mine!;
}
/* Audio is snapshotted by its sha256 only (its bytes as text say nothing). */
const shown = (answer: Answer): Answer =>
	answer.headers['content-type']?.startsWith('audio/') ? { ...answer, body: '(audio)' } : answer;

const owner = async (body?: unknown, extra: Record<string, string> = {}): Promise<Step['call']> => ({
	method: 'POST',
	headers: {
		Origin: SITE,
		Cookie: await sessionCookie(OWNER),
		...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		...extra
	},
	...(body === undefined ? {} : { body: JSON.stringify(body) })
});

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

describe('/api/overlay/refresh', () => {
	for (const [label, query] of [
		['what overlays ask when their live connection is down', ''],
		['with the channels an overlay shows', '?c=twitch:gxufy&c=kick:xqc'],
		['with a channel that is not a name', '?c=twitch:bad%20name'],
		['with one channel', '?c=youtube:%40mrbeast']
	] as const) {
		it(`answers ${label}`, async () => {
			const mine = await ask('refresh', { query });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(200);
			expect(JSON.parse(mine.body)).toMatchObject({ now: NOW });
		});
	}

	it('refreshes every overlay for the owner', async () => {
		const mine = await run(async () => [
			{ route: 'refresh', call: await owner() },
			{ route: 'refresh', call: {} }
		]);
		expect(mine).toMatchSnapshot();
		expect(JSON.parse(mine[0]!.body)).toEqual({ token: NOW });
		expect(JSON.parse(mine[1]!.body).token).toBe(NOW);
	});

	it("refreshes one channel's overlays", async () => {
		const mine = await run(async () => [
			{ route: 'refresh', call: await owner({ platform: 'twitch', channel: 'GxuFy' }) },
			{ route: 'refresh', call: await owner({ channel: 'xqc' }) },
			{ route: 'refresh', call: { query: '?c=twitch:gxufy' } }
		]);
		expect(mine).toMatchSnapshot();
		expect(JSON.parse(mine[0]!.body)).toEqual({ target: { platform: 'twitch', channel: 'gxufy', at: NOW } });
		expect(JSON.parse(mine[2]!.body).targets.length).toBe(2);
	});

	it('sends a command to one channel only', async () => {
		const mine = await run(async () => [
			{ route: 'refresh', call: await owner({ platform: 'twitch', channel: 'gxufy', command: '!flosschat reload' }) },
			{ route: 'refresh', call: { query: '?c=twitch:gxufy' } },
			{ route: 'refresh', call: { query: '?c=kick:someone' } }
		]);
		/* Each command gets a random id: snapshotted with it blanked, then checked. */
		const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
		const blank = (answers: Answer[]) =>
			answers.map((answer) => {
				const { etag: _etag, ...headers } = answer.headers;
				return { ...answer, headers, body: answer.body.replace(UUID, 'ID'), sha256: '' };
			});
		expect(blank(mine)).toMatchSnapshot();
		expect(mine[0]!.status).toBe(200);
		const { command } = JSON.parse(mine[0]!.body) as { command: { id: string; text: string } };
		expect(command.text).toBe('reload');
		expect(JSON.parse(mine[1]!.body).commands).toEqual([command]);
		expect(JSON.parse(mine[2]!.body).commands).toHaveLength(0);
	});

	const refused: Array<[string, () => Promise<Step['call']>, number]> = [
		['a viewer', async () => ({ ...(await owner()), headers: { Origin: SITE, Cookie: await sessionCookie(VIEWER) } }), 403],
		['someone signed out', async () => ({ method: 'POST', headers: { Origin: SITE } }), 403],
		['the owner from another site', async () => owner(undefined, { Origin: 'https://evil.example' }), 403],
		['the owner with no Origin', async () => {
			const call = await owner();
			const { Origin: _origin, ...headers } = call.headers!;
			return { ...call, headers };
		}, 403],
		['a channel that is not a name', async () => owner({ platform: 'twitch', channel: 'bad name!' }), 400],
		['an unknown platform', async () => owner({ platform: 'myspace', channel: 'gxufy' }), 400],
		['a command only streamers may run', async () => owner({ platform: 'twitch', channel: 'gxufy', command: '!flosschat paint jiltv' }), 400],
		['a command that is not one', async () => owner({ platform: 'twitch', channel: 'gxufy', command: 'rm -rf' }), 400],
		['a DELETE', async () => ({ method: 'DELETE', headers: { Origin: SITE, Cookie: await sessionCookie(OWNER) } }), 405]
	];
	for (const [label, call, status] of refused) {
		it(`refuses ${label}`, async () => {
			const mine = await ask('refresh', await call());
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(status);
		});
	}

	it('limits "refresh all" (10 in 10 minutes)', async () => {
		const call = await owner();
		vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
		const server = await serve(ROUTES.refresh.load);
		try {
			const statuses: number[] = [];
			for (let i = 0; i < 11; i++) statuses.push((await send(server, { ...call, path: ROUTES.refresh.path })).status);
			expect(statuses).toEqual([...Array(10).fill(200), 429]);
		} finally {
			await server.close();
		}
	});

	it('a refresh sent by one copy of the app is what another copy tells overlays (one database)', async () => {
		vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
		const sent = await once(ROUTES.refresh.load, { ...(await owner({ platform: 'kick', channel: 'adinross' })), path: ROUTES.refresh.path });
		expect(sent.status).toBe(200);
		const seen = JSON.parse((await once(ROUTES.refresh.load, { path: `${ROUTES.refresh.path}?c=kick:adinross` })).body);
		expect(seen.targets).toEqual([{ platform: 'kick', channel: 'adinross', at: NOW }]);
	});
});

describe('/api/badges/give', () => {
	it('lists what was given', async () => {
		const mine = await ask('give', { headers: { Cookie: await sessionCookie(OWNER) } });
		expect(mine).toMatchSnapshot();
		expect(JSON.parse(mine.body)).toMatchObject({ given: [], founders: [] });
	});

	it('gives, lists and takes back a tier', async () => {
		const mine = await run(async () => [
			{ route: 'give', call: await owner({ login: 'SomeViewer' }) },
			{ route: 'give', call: await owner({ login: 'someviewer', tier: 'top-suvy' }) },
			{ route: 'give', call: { headers: { Cookie: await sessionCookie(OWNER) } } },
			{ route: 'give', call: await owner({ takeBack: VIEWER.id }) },
			{ route: 'give', call: { headers: { Cookie: await sessionCookie(OWNER) } } }
		]);
		expect(mine).toMatchSnapshot();
		expect(mine.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200]);
		expect(JSON.parse(mine[2]!.body).given.length).toBeGreaterThan(0);
	});

	it('gives a Founder spot once', async () => {
		const mine = await run(async () => [
			{ route: 'give', call: await owner({ login: 'someviewer', tier: 'founder' }) },
			{ route: 'give', call: await owner({ login: 'someviewer', tier: 'founder' }) },
			{ route: 'give', call: await owner({ login: 'gxufy', tier: 'founder' }) },
			{ route: 'give', call: await owner({ takeBack: VIEWER.id, badge: 'founder' }) }
		]);
		expect(mine).toMatchSnapshot();
		/* Giving it again keeps the one given; the owner holds every badge already. */
		expect(mine.map((answer) => answer.status)).toEqual([200, 200, 409, 200]);
		expect(mine[1]!.body).toBe(mine[0]!.body);
	});

	const refused: Array<[string, () => Promise<Step['call']>, number, ReturnType<typeof upstream>?]> = [
		['a viewer listing', async () => ({ headers: { Cookie: await sessionCookie(VIEWER) } }), 403],
		['someone signed out', async () => ({}), 403],
		['a viewer giving', async () => ({ ...(await owner({ login: 'someviewer' })), headers: { Origin: SITE, 'Content-Type': 'application/json', Cookie: await sessionCookie(VIEWER) } }), 403],
		['the owner from another site', async () => owner({ login: 'someviewer' }, { Origin: 'https://evil.example' }), 403],
		['a name that is not a Twitch name', async () => owner({ login: 'bad name!' }), 400],
		['an unknown tier', async () => owner({ login: 'someviewer', tier: 'gold' }), 400],
		['an account Twitch does not know', async () => owner({ login: 'nobodyhere' }), 404],
		['a take-back of an id that is not one', async () => owner({ takeBack: 'abc' }), 400],
		['a take-back of an unknown badge', async () => owner({ takeBack: VIEWER.id, badge: 'owner' }), 400],
		['a DELETE', async () => ({ method: 'DELETE', headers: { Origin: SITE, Cookie: await sessionCookie(OWNER) } }), 405]
	];
	for (const [label, call, status] of refused) {
		it(`refuses ${label}`, async () => {
			const mine = await ask('give', await call());
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(status);
		});
	}

	for (const [label, answer] of [
		['Twitch failing', () => new Response('down', { status: 500 })],
		['Twitch out of reach', () => Promise.reject(new TypeError('fetch failed'))]
	] as const) {
		it(`answers ${label}`, async () => {
			const fetches = () => upstream({ 'https://gql.twitch.tv/gql': answer });
			const mine = await ask('give', await owner({ login: 'someviewer' }), fetches);
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(503);
		});
	}

	it('is off (404) without sign-in', async () => {
		vi.stubEnv('FLOSSCHAT_SESSION_SECRET', '');
		const mine = await ask('give', {});
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(404);
	});

	it('a badge given by one copy of the app is listed by another (one database)', async () => {
		vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(storeDir, `store-${++storeCount}.db`));
		vi.stubGlobal('fetch', upstream());
		const given = await once(ROUTES.give.load, { ...(await owner({ login: 'someviewer', tier: 'suvy' })), path: ROUTES.give.path });
		expect(given.status).toBe(200);
		const list = JSON.parse((await once(ROUTES.give.load, { path: ROUTES.give.path, headers: { Cookie: await sessionCookie(OWNER) } })).body);
		expect(list.given.map((entry: { twitchId?: string; id?: string }) => entry.twitchId ?? entry.id)).toContain(VIEWER.id);
	});
});

describe('/api/tts', () => {
	const STREAMELEMENTS = 'https://api.streamelements.com/kappa/v2/speech';
	const STREAMLABS = 'https://streamlabs.com/polly/speak';
	const POLLY = 'https://polly.streamlabs.com/';
	const say = { query: '?voice=Brian&text=hello%20chat' };
	const cases: Array<[string, Record<string, Upstream>, number]> = [
		['StreamElements speaking', { [STREAMELEMENTS]: () => audio() }, 200],
		['StreamElements down, Streamlabs speaking', {
			[STREAMELEMENTS]: () => new Response('down', { status: 500 }),
			[STREAMLABS]: () => json({ success: true, speak_url: `${POLLY}v1/speech?x=1` }),
			[POLLY]: () => audio(Buffer.from([0xff, 0xf3, 0x44, 0xc4, 0x00, 0x80]))
		}, 200],
		['StreamElements sending a web page', {
			[STREAMELEMENTS]: () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
			[STREAMLABS]: () => new Response('down', { status: 500 })
		}, 503],
		['Streamlabs pointing somewhere untrusted', {
			[STREAMELEMENTS]: () => new Response('down', { status: 500 }),
			[STREAMLABS]: () => json({ success: true, speak_url: 'https://evil.example/a.mp3' })
		}, 503],
		['both out of reach', {}, 503]
	];
	for (const [label, routes, status] of cases) {
		it(`answers ${label}`, async () => {
			const mine = await ask('tts', say, () => upstream(routes));
			expect(shown(mine)).toMatchSnapshot();
			expect(mine.status).toBe(status);
			expect(mine.headers['cache-control']).toBe('private, no-store');
			if (status === 200) expect(mine.headers['content-type']).toBe('audio/mpeg');
		});
	}

	it('sends the audio byte for byte', async () => {
		const mine = await ask('tts', say, () => upstream({ [STREAMELEMENTS]: () => audio() }));
		const expected = (await import('node:crypto')).createHash('sha256').update(AUDIO).digest('hex');
		expect(mine.sha256).toBe(expected);
	});

	for (const query of ['', '?text=', '?text=%20%20', `?text=${'a'.repeat(551)}`, '?text=hi&voice=bad%20voice', '?text=a&text=b', '?text=hi&voice=a&voice=b']) {
		it(`refuses ${query || 'no query'}`, async () => {
			const mine = await ask('tts', { query });
			expect(mine).toMatchSnapshot();
			expect(mine.status).toBe(400);
		});
	}

	it('refuses POST', async () => {
		const mine = await ask('tts', { method: 'POST', query: say.query });
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(405);
	});
});
