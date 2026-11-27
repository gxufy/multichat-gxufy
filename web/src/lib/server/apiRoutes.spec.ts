import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { appPublicDir } from '@/lib/server/appPublicDir';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { runApiRoute, type ApiRouteModule } from './apiRoute.ts';

/*
 * Every API route's answers, byte for byte: status, every header but the
 * connection ones, and the body, for accepted and failing upstream answers
 * (fetch is stubbed), refused inputs, repeats with an ETag and other methods.
 * Each runs over real HTTP in this process with freshly loaded route modules.
 * The snapshots are the answers the Next.js app gave (this app was checked
 * against it, request for request, before it was retired); a change to one
 * is a change visitors see.
 */

type Loader = () => Promise<ApiRouteModule>;

/* The routes this app answers (web/src/routes/api/...). */
/* A supporter store of their own for the routes that read one (empty: only the
   Owner badge), opened the way the new app opens it (no daily copies). */
const storeDir = mkdtempSync(path.join(tmpdir(), 'fc-parity-store-'));
const STORE_ENV = {
	GXUFY_SUPPORTER_STORE_PATH: path.join(storeDir, 'supporters.db'),
	GXUFY_SUPPORTER_STORE_BACKUPS: 'off'
};
/* Settings the search routes read; the values are made up, upstream is stubbed. */
const SEARCH_ENV = {
	TWITCH_CLIENT_ID: 'parity-client-id',
	TWITCH_CLIENT_SECRET: 'parity-client-secret',
	KICK_TYPESENSE_SEARCH_KEY: 'parity-search-key'
};

const MOVED_ROUTES: Record<string, { load: Loader; query?: string; env?: Record<string, string> }> = {
	'/api/twitch/badges': { load: () => import('@/api/twitch/badges'), query: '?channel=xqc&preview=1' },
	'/api/twitch/badgehq-badges': { load: () => import('@/api/twitch/badgehq-badges') },
	'/api/twitch/bchat-badges': { load: () => import('@/api/twitch/bchat-badges') },
	'/api/twitch/chatsen-badges': { load: () => import('@/api/twitch/chatsen-badges') },
	'/api/twitch/chatty-badges': { load: () => import('@/api/twitch/chatty-badges') },
	'/api/twitch/dankchat-badges': { load: () => import('@/api/twitch/dankchat-badges') },
	'/api/twitch/enhancer-badges': { load: () => import('@/api/twitch/enhancer-badges') },
	'/api/twitch/ffzap-badges': { load: () => import('@/api/twitch/ffzap-badges') },
	'/api/twitch/jilchat-badges': { load: () => import('@/api/twitch/jilchat-badges'), query: '?userId=204219574' },
	'/api/twitch/previews-badges': { load: () => import('@/api/twitch/previews-badges') },
	'/api/twitch/emote-resources': { load: () => import('@/api/twitch/emote-resources'), query: '?channelId=71092938' },
	'/api/twitch/profile': { load: () => import('@/api/twitch/profile'), query: '?id=71092938' },
	'/api/twitch/preview-identity': { load: () => import('@/api/twitch/preview-identity'), query: '?login=gxufy' },
	'/api/twitch/hypetrain': { load: () => import('@/api/twitch/hypetrain'), query: '?channel=xqc' },
	'/api/kick/channel': { load: () => import('@/api/kick/channel'), query: '?channel=adinross' },
	'/api/kick/history': { load: () => import('@/api/kick/history'), query: '?channelId=668' },
	'/api/youtube/live': { load: () => import('@/api/youtube/live'), query: '?channel=@mrbeast' },
	'/api/twitch/channel-search': { load: () => import('@/api/twitch/channel-search'), query: '?q=xqc', env: SEARCH_ENV },
	'/api/kick/channel-search': { load: () => import('@/api/kick/channel-search'), query: '?q=adin', env: SEARCH_ENV },
	'/api/youtube/channel-search': { load: () => import('@/api/youtube/channel-search'), query: '?q=mrbeast', env: SEARCH_ENV },
	'/api/tiktok/channel-search': { load: () => import('@/api/tiktok/channel-search'), query: '?q=gxufy', env: SEARCH_ENV },
	'/api/twitch/gxufy-badges': { load: () => import('@/api/twitch/gxufy-badges'), env: STORE_ENV },
	'/api/twitch/gxufy-badges-version': { load: () => import('@/api/twitch/gxufy-badges-version'), env: STORE_ENV },
	'/api/v1/badges': { load: () => import('@/api/v1/badges'), env: STORE_ENV },
	'/api/twitch/support-user': {
		load: () => import('@/api/twitch/support-user'),
		query: '?login=gxufy',
		env: { ...STORE_ENV, GXUFY_SUPPORT_PAGE_ENABLED: '1' }
	},
	/* No TikTok here: its lookup goes through a library, not fetch. */
	'/api/viewers': { load: () => import('@/api/viewers'), query: '?twitch=xqc&youtube=mrbeast' },
	'/api/audience': { load: () => import('@/api/audience'), query: '?twitch=xqc&youtube=mrbeast' },
	'/api/jiltv/cosmetics': {
		load: () => import('@/api/jiltv/cosmetics'),
		query: '?logins=gxufy,jilence&channel=gxufy',
		env: { GXUFY_JILTV_COSMETICS_ENABLED: '1' }
	},
	/* The live badge list (patched by the overlay control stream's Limerino
	   feed, which moves with it; see nextApiStreams.spec.ts). */
	'/api/twitch/limerino-badges': { load: () => import('@/api/twitch/limerino-badges') }
};

/* Routes that answer OPTIONS themselves (for other sites' pages). */
const ANSWERS_OPTIONS = new Set(['/api/v1/badges', '/api/viewers', '/api/audience']);

/* Requests each of those refuses before asking upstream (bad or missing input). */
const REFUSED_QUERIES: Record<string, string[]> = {
	'/api/twitch/badges': ['?channel=no%20spaces!'],
	'/api/twitch/jilchat-badges': ['', '?userId=abc'],
	'/api/twitch/emote-resources': ['', '?channelId=abc', '?channelId=1&channelId=2'],
	'/api/twitch/profile': ['', '?id=abc'],
	'/api/twitch/preview-identity': ['', '?login=bad%20login', '?login=gxufy&providers=nope'],
	'/api/twitch/hypetrain': ['', '?channel=a&channel=b', '?channel=bad%20name'],
	'/api/kick/channel': ['', '?channel=bad%20name!'],
	'/api/kick/history': ['', '?channelId=abc'],
	'/api/youtube/live': ['', '?channel=%00'],
	'/api/twitch/channel-search': ['', '?q=a&q=b', `?q=${'x'.repeat(80)}`],
	'/api/kick/channel-search': ['', '?q=a&q=b'],
	'/api/youtube/channel-search': ['', '?q=a&q=b'],
	'/api/tiktok/channel-search': ['', '?q=a&q=b'],
	'/api/v1/badges': ['?user=abc', '?user=1&user=2', '?user=204219574'],
	'/api/twitch/support-user': ['', '?login=bad%20login'],
	'/api/viewers': ['', '?twitch=bad%20name', '?twitch=a&twitch=b', '?tiktok=bad%20name'],
	'/api/audience': ['', '?youtube=bad%20name', '?twitch=a&twitch=b'],
	'/api/jiltv/cosmetics': [
		'',
		'?logins=bad%20name',
		'?logins=a&logins=b',
		'?logins=a&channel=bad%20name',
		'?logins=a&channel=a&channel=b',
		`?logins=${Array.from({ length: 51 }, (_, i) => `u${i}`).join(',')}`
	]
};

type Upstream = (input?: RequestInfo | URL) => Promise<Response>;
type Answer = { status: number; headers: Record<string, string>; body: string; chunked?: boolean };
type Call = { method?: string; path: string; headers?: Record<string, string>; body?: string };

const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);

function listen(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
		});
	});
}

function send(port: number, call: Call): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: '127.0.0.1', port, method: call.method ?? 'GET', path: call.path, headers: call.headers },
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const headers: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						if (!IGNORED_HEADERS.has(key) && value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
					}
					resolve({
						status: res.statusCode ?? 0,
						headers,
						body: Buffer.concat(chunks).toString(),
						chunked: res.headers['transfer-encoding'] === 'chunked'
					});
				});
			}
		);
		req.on('error', reject);
		if (call.body) req.write(call.body);
		req.end();
	});
}

async function throughThisApp(load: Loader, call: Call): Promise<Answer> {
	vi.resetModules();
	const route = await load();
	const server = await listen(async (req, res) => {
		const request = getRequest({ request: req, response: res, base: 'http://localhost' });
		const event = {
			request,
			url: new URL(request.url),
			getClientAddress: () => req.socket.remoteAddress ?? '',
			platform: { req }
		} as unknown as RequestEvent;
		await setResponse(res, await runApiRoute(route, event));
	});
	try {
		return await send(server.port, call);
	} finally {
		await server.close();
	}
}

/* Whether the body went out in chunks is the HTTP server's choice, not the route's. */
function framed(answer: Answer): Answer {
	const { chunked: _chunked, ...rest } = answer;
	return rest;
}

function useEnv(env: Record<string, string> = {}): void {
	for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

async function ask(path: string, call: Omit<Call, 'path'>, upstream: Upstream): Promise<Answer> {
	const { load, query = '', env } = MOVED_ROUTES[path];
	useEnv(env);
	vi.stubGlobal('fetch', vi.fn(upstream));
	return framed(await throughThisApp(load, { ...call, path: path + query }));
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/* Upstream answers each route gets: one it accepts where we have one, then the failures. */
const ACCEPTED: Record<string, Upstream> = {
	'/api/twitch/badges': async () =>
		json({
			data: {
				badges: [{ setID: 'vip', version: '1', imageURL: 'https://cdn.example/vip.png' }],
				user: { id: '42', broadcastBadges: [{ setID: 'subscriber', version: '1', imageURL: 'https://cdn.example/sub.png' }] }
			}
		}),
	'/api/twitch/dankchat-badges': async () =>
		json([{ type: 'DankChat', url: 'https://flxrs.com/dankchat/badges/dank.png', users: ['123', 456] }]),
	'/api/viewers': async () => json({ data: { user: { stream: { viewersCount: 1234 } } } }),
	'/api/audience': async () => json({ data: { user: { stream: { viewersCount: 1234 } } } }),
	/* Limerino's catalog and holders lists. */
	'/api/twitch/limerino-badges': async (input) => {
		const files = [18, 36, 54, 72].map((width) => ({ name: `${width / 18}x.webp`, width, height: width, frame_count: 8, format: 'WEBP' }));
		return String(input).includes('/holders')
			? json({ users: { '204219574': ['first'] } }, 200)
			: json({ badges: [{ id: 'first', kind: 'BADGE', data: { tooltip: 'First Limerino', host: { url: '//api.limerino.com/v1/badges/art/first/4', files } } }] });
	},
	/* JilTV's lookup (gxufy wears a paint, jilence nothing), then its catalog. */
	'/api/jiltv/cosmetics': async (input) =>
		String(input).startsWith('https://api.jiltv.app/v1/cosmetics/twitch?')
			? json({ users: { gxufy: { p: '01M5Q3S869E87B1QV8ZEWEHJSJ' } } })
			: json({
					paints: [
						{
							id: '01M5Q3S869E87B1QV8ZEWEHJSJ',
							name: 'Molten Gold',
							v: 2,
							data: { v: 1, layers: [], shadows: [{ x: 0, y: 0, blur: 5, color: '#ffb30059' }], fallback: '#e7be6cff' },
							texture: { url: 'https://cdn.jiltv.app/paints/8e6c43fd.webp', still: 'https://cdn.jiltv.app/paints/8e6c43fd-0.webp', w: 360, h: 54 }
						}
					],
					badges: [],
					decorations: [],
					cdn: 'https://cdn.jiltv.app'
				})
};
const FAILURES: Record<string, Upstream> = {
	'an error status': async () => new Response('down', { status: 500 }),
	'a body that is not JSON': async () => new Response('<html>nope</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
	'an empty list': async () => json([]),
	'an empty object': async () => json({}),
	'no answer at all': async () => {
		throw new TypeError('fetch failed');
	}
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

afterAll(async () => {
	const { __closeSupporterStoresForTests } = await import('@/lib/server/supporterStore');
	__closeSupporterStoresForTests();
	rmSync(storeDir, { recursive: true, force: true });
});

describe('the API routes', () => {
	for (const path of Object.keys(MOVED_ROUTES)) {
		describe(path, () => {
			for (const [label, upstream] of Object.entries({ ...(ACCEPTED[path] ? { accepted: ACCEPTED[path] } : {}), ...FAILURES })) {
				it(`when upstream gives ${label}`, async () => {
					vi.spyOn(console, 'error').mockImplementation(() => undefined);
					expect(await ask(path, {}, upstream)).toMatchSnapshot();
				});
			}

			it('a repeat with the same ETag is a 304', async () => {
				const upstream = ACCEPTED[path] ?? FAILURES['an error status'];
				const first = await ask(path, {}, upstream);
				const etag = first.headers.etag;
				expect(etag).toBeTruthy();
				const mine = await ask(path, { headers: { 'If-None-Match': etag } }, upstream);
				expect(mine).toMatchSnapshot();
				expect(mine.status).toBe(304);
			});

			for (const query of REFUSED_QUERIES[path] ?? []) {
				it(`answers ${query || 'no query'}`, async () => {
					const { load, env } = MOVED_ROUTES[path];
					useEnv(env);
					vi.stubGlobal('fetch', vi.fn(FAILURES['an error status']));
					expect(framed(await throughThisApp(load, { path: path + query }))).toMatchSnapshot();
				});
			}

			for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
				it(`refuses ${method}`, async () => {
					const mine = await ask(
						path,
						method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' } : { method },
						FAILURES['an error status']
					);
					expect(mine).toMatchSnapshot();
					if (!(method === 'OPTIONS' && ANSWERS_OPTIONS.has(path))) expect(mine.status).toBe(405);
				});
			}
		});
	}

	it('the JilTV answers cover a drawn paint and a chatter wearing none', async () => {
		const mine = await ask('/api/jiltv/cosmetics', {}, ACCEPTED['/api/jiltv/cosmetics']);
		const { paints } = JSON.parse(mine.body) as { paints: Record<string, { name?: string } | null> };
		expect(paints.gxufy?.name).toBe('Molten Gold');
		expect(paints.jilence).toBeNull();
	});

	it('the JilTV route stays off (404) without its switch', async () => {
		const { load } = MOVED_ROUTES['/api/jiltv/cosmetics'];
		vi.stubGlobal('fetch', vi.fn(FAILURES['an error status']));
		const mine = framed(await throughThisApp(load, { path: '/api/jiltv/cosmetics?logins=gxufy' }));
		expect(mine).toMatchSnapshot();
		expect(mine.status).toBe(404);
	});

	describe('/api/youtube/chat (a POST, the YouTube chat fallback)', () => {
		const load = () => import('@/api/youtube/chat');
		const post = (body: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
		const VALID = JSON.stringify({ apiKey: 'AIzaParityKey', clientVersion: '2.20261125.01.00', continuation: 'parity-continuation' });
		const answer = async (call: Omit<Call, 'path'>, upstream: Upstream) => {
			vi.stubGlobal('fetch', vi.fn(upstream));
			return framed(await throughThisApp(load, { ...call, path: '/api/youtube/chat' }));
		};
		const UPSTREAMS: Record<string, Upstream> = {
			accepted: async () => json({ continuationContents: { liveChatContinuation: { actions: [], continuations: [] } } }),
			...FAILURES
		};
		for (const [label, upstream] of Object.entries(UPSTREAMS)) {
			it(`when upstream gives ${label}`, async () => {
				vi.spyOn(console, 'error').mockImplementation(() => undefined);
				const mine = await answer(post(VALID), upstream);
				expect(mine).toMatchSnapshot();
				if (label === 'accepted') expect(mine.status).toBe(200);
			});
		}
		for (const [label, body] of Object.entries({
			'no body': '',
			'bad JSON': '{',
			'missing fields': '{"apiKey":"a"}',
			'a field too long': JSON.stringify({ apiKey: 'a', clientVersion: 'b', continuation: 'c'.repeat(9_000) })
		})) {
			it(`refuses ${label}`, async () => {
				const mine = await answer(post(body), FAILURES['an error status']!);
				expect(mine).toMatchSnapshot();
				expect(mine.status).toBeGreaterThanOrEqual(400);
			});
		}
		for (const method of ['GET', 'HEAD', 'DELETE']) {
			it(`refuses ${method}`, async () => {
				const mine = await answer({ method }, FAILURES['an error status']!);
				expect(mine).toMatchSnapshot();
				expect(mine.status).toBe(405);
			});
		}
	});

	it('the accepted answers really are 200s (so the snapshots cover success)', async () => {
		for (const path of Object.keys(ACCEPTED)) {
			const mine = await ask(path, {}, ACCEPTED[path]);
			expect(mine.status).toBe(200);
			expect(mine.headers['content-type']).toBe('application/json; charset=utf-8');
		}
	});
});

/* The favicon reads the Gxufy avatar from web/public (appPublicDir) and
   answers every method alike. */
describe('/api/favicon', () => {
	const load: Loader = () => import('@/api/favicon');
	for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
		it(`answers ${method}`, async () => {
			const call = { method, path: '/api/favicon' };
			expect(framed(await throughThisApp(load, call))).toMatchSnapshot();
		});
	}

	it('draws the avatar', async () => {
		const avatar = readFileSync(path.join(appPublicDir(), 'gxufy-avatar.gif')).toString('base64');
		const answer = await throughThisApp(load, { path: '/api/favicon' });
		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
		expect(answer.headers['cache-control']).toBe('public, max-age=86400, s-maxage=604800');
		expect(answer.body).toContain(`href="data:image/gif;base64,${avatar}"`);
	});
});

/* For /api/viewers the route file answers the preflight itself, before the
   handler (as the Next.js app's middleware did). */
describe('the /api/viewers preflight', () => {
	const event = (method: string) => {
		const request = new Request('https://flosschat.app/api/viewers?twitch=xqc', { method });
		return { request, url: new URL(request.url), getClientAddress: () => '203.0.113.5' } as unknown as RequestEvent;
	};
	const answer = (response: Response) => ({
		status: response.status,
		headers: Object.fromEntries([...response.headers].filter(([key]) => !key.startsWith('x-middleware-')))
	});

	it('is answered before the handler', async () => {
		const { fallback } = await import('../../routes/api/viewers/+server.ts');
		const mine = await fallback(event('OPTIONS'));
		expect(answer(mine)).toMatchSnapshot();
		expect(mine.status).toBe(204);
		expect(await mine.text()).toBe('');
	});

	it('every other method still goes to the handler', async () => {
		const { fallback } = await import('../../routes/api/viewers/+server.ts');
		const refused = await fallback(event('POST'));
		expect(refused.status).toBe(405);
		expect(refused.headers.get('allow')).toBe('GET, OPTIONS');
	});
});

/* Routes made up for the test, each using one more part of what apiRoute gives
   a handler, so the parts no route uses yet are held to the same behaviour. */
type TestHandler = (req: ApiRequest, res: ApiResponse) => unknown;
const testRoute = (handler: TestHandler, config?: ApiRouteModule['config']): Loader =>
	async () => ({ default: handler, ...(config ? { config } : {}) });

const TEST_ROUTES: Record<string, Loader> = {
	echo: testRoute((req, res) =>
		res.status(201).json({
			method: req.method,
			url: req.url,
			query: req.query,
			body: req.body ?? null,
			cookies: req.cookies,
			header: req.headers['x-test'] ?? null
		})
	),
	throws: testRoute(() => {
		throw new Error('boom');
	}),
	throwsLater: testRoute(async () => {
		await new Promise((resolve) => setTimeout(resolve, 2));
		throw new Error('boom');
	}),
	text: testRoute((_req, res) => res.send('hello there')),
	bytes: testRoute((_req, res) => res.send(Buffer.from('raw bytes'))),
	number: testRoute((_req, res) => res.send(42)),
	noContent: testRoute((_req, res) => res.status(204).json({ ignored: true })),
	redirect: testRoute((_req, res) => res.redirect(308, '/elsewhere?x=1')),
	redirectDefault: testRoute((_req, res) => res.redirect('/elsewhere')),
	cookies: testRoute((_req, res) => {
		res.setHeader('Set-Cookie', ['a=1; Path=/; HttpOnly', 'b=2; Path=/']);
		res.setHeader('Cache-Control', 'no-store');
		res.status(200).json({ ok: true });
	}),
	stream: testRoute(async (_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' });
		res.write('data: 1\n\n');
		await new Promise((resolve) => setTimeout(resolve, 5));
		res.write(Buffer.from('data: 2\n\n'));
		res.end('data: end\n\n');
	}),
	late: testRoute((_req, res) => {
		setTimeout(() => res.status(202).json({ late: true }), 5);
	}),
	plainEnd: testRoute((_req, res) => {
		res.statusCode = 418;
		res.setHeader('Content-Type', 'text/plain');
		res.end('short and stout');
	}),
	raw: testRoute(
		async (req, res) => {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			res.json({ raw, parsed: req.body === undefined });
		},
		{ api: { bodyParser: false } }
	),
	small: testRoute((req, res) => res.json({ body: req.body }), { api: { bodyParser: { sizeLimit: '10b' } } }),
	/* bodyParser: true, as a route file may write it: parsed with the default limit. */
	parsedTrue: testRoute((req, res) => res.json({ body: req.body }), { api: { bodyParser: true } }),
	/* A raw body read with a cap of its own (as the Stripe webhook does): the
	   handler stops reading early and answers; the rest of the body is left. */
	rawCapped: testRoute(
		async (req, res) => {
			let size = 0;
			for await (const chunk of req) {
				size += (chunk as Buffer).length;
				if (size > 1024) return res.status(400).json({ error: 'Too big.' });
			}
			return res.json({ size });
		},
		{ api: { bodyParser: false } }
	)
};

async function askTest(name: string, call: Call): Promise<Answer> {
	return framed(await throughThisApp(TEST_ROUTES[name], call));
}

describe('everything apiRoute does around a handler', () => {
	const cases: Array<[string, string, Call]> = [
		['echo', 'a plain GET with repeated query keys, cookies and a header', { path: '/t?a=1&a=2&b=%20x+y&c=', headers: { cookie: 'one=1; two="t%20wo"; one=dup', 'x-test': 'yes' } }],
		['echo', 'a JSON body', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: '{"n":1,"s":"é"}' }],
		['echo', 'an empty JSON body', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: '' }],
		['echo', 'a JSON body that is not JSON', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: '{nope' }],
		['echo', 'a form body', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1&a=2&b=x%20y' }],
		['echo', 'a text body', { method: 'POST', path: '/t', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'just text' }],
		['echo', 'a body of an odd type', { method: 'PUT', path: '/t', headers: { 'Content-Type': 'application/octet-stream' }, body: 'bytes' }],
		['echo', 'a matching ETag', { path: '/t', headers: { 'If-None-Match': '"x", "y"' } }],
		['echo', 'If-None-Match with no-cache', { path: '/t', headers: { 'If-None-Match': '*', 'Cache-Control': 'no-cache' } }],
		['echo', 'If-None-Match: *', { path: '/t', headers: { 'If-None-Match': '*' } }],
		['echo', 'HEAD', { method: 'HEAD', path: '/t' }],
		['throws', 'a handler that throws', { path: '/t' }],
		['throwsLater', 'a handler that throws after waiting', { path: '/t' }],
		['text', 'a text answer', { path: '/t' }],
		['bytes', 'a Buffer answer', { path: '/t' }],
		['number', 'a number answer', { path: '/t' }],
		['noContent', 'a 204', { path: '/t' }],
		['redirect', 'a redirect with a status', { path: '/t' }],
		['redirectDefault', 'a redirect without one', { path: '/t' }],
		['cookies', 'two cookies', { path: '/t' }],
		['stream', 'a stream written in parts', { path: '/t' }],
		['late', 'an answer sent after the handler returned', { path: '/t' }],
		['plainEnd', 'status and end() by hand', { path: '/t' }],
		['raw', 'a raw body read by the handler', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: '{"sig":"kept as sent"}' }],
		['small', 'a body over its size limit', { method: 'POST', path: '/t', headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(40) }],
		['small', 'a body under it', { method: 'POST', path: '/t', headers: { 'Content-Type': 'text/plain' }, body: 'tiny' }],
		['parsedTrue', 'bodyParser: true parses JSON', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: '{"a":[1,2]}' }],
		/* Over the cap (the handler stops reading and answers) is checked on the
		   real servers behind Caddy: this in-process client never finishes that
		   request with either app. */
		['rawCapped', 'a raw body under the handler\'s own cap', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(500) }],
		['rawCapped', 'a raw body just at it', { method: 'POST', path: '/t', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(1024) }]
	];
	for (const [name, label, call] of cases) {
		it(label, async () => {
			vi.spyOn(console, 'error').mockImplementation(() => undefined);
			vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			expect(await askTest(name, call)).toMatchSnapshot();
		});
	}

	it('the echo answer\'s ETag answers a 304', async () => {
		const first = await askTest('echo', { path: '/t' });
		const mine = await askTest('echo', { path: '/t', headers: { 'If-None-Match': first.headers.etag } });
		expect(mine.status).toBe(304);
		expect(mine).toMatchSnapshot();
	});
});
