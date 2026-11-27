import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runApiRoute, type ApiRouteModule } from './apiRoute.ts';

/*
 * The long-lived streams (server-sent events): the status, headers and first
 * events they open with (snapshots of what the Next.js app sent, which this
 * app was checked against before it was retired); when the viewer leaves, the
 * route lets go of its hub subscription; and when a deploy hands over, the
 * route sends its "move" message and ends the response, so the browser
 * reconnects to the other server copy. Each runs over real HTTP through
 * apiRoute. The hubs (Kick, YouTube, TikTok, Owner tools) are stand-ins that
 * record subscriptions.
 */

type Listener = (data: object, serialized: string) => void;

/* Every hub subscription still held, by hub. */
const hubs = vi.hoisted(() => ({
	active: { kick: new Set<object>(), youtube: new Set<object>(), tiktok: new Set<object>(), live: new Set<object>() },
	moves: [] as Array<() => void>
}));

function fakeSubscribe(name: 'kick' | 'youtube' | 'tiktok') {
	return (...args: unknown[]) => {
		const send = args.find((arg) => typeof arg === 'function') as Listener;
		const token = {};
		hubs.active[name].add(token);
		const status = { type: 'status', status: 'connecting' };
		send(status, JSON.stringify(status));
		return () => {
			hubs.active[name].delete(token);
		};
	};
}

vi.mock('@/lib/server/kickRealtimeHub', () => ({ subscribeKickRealtime: fakeSubscribe('kick') }));
vi.mock('@/lib/server/youtubeHub', () => ({ subscribeYouTube: fakeSubscribe('youtube') }));
vi.mock('@/lib/tiktokHub', () => ({ subscribe: fakeSubscribe('tiktok') }));
vi.mock('@/lib/server/limerinoLive', () => ({ ensureLimerinoLive: () => undefined }));
vi.mock('@/lib/server/overlayLiveHub', () => ({
	parseOverlayChannelParams: () => [],
	overlayLiveHasRoom: () => true,
	overlayLiveBadgeConnectionCount: () => 0,
	broadcastOverlayBadgeEvent: () => 0,
	addOverlayLiveSink: async (sink: { write(chunk: string): unknown }) => {
		hubs.active.live.add(sink);
		sink.write('event: state\ndata: {"token":1,"targets":[],"commands":[],"now":5}\n\n');
	},
	removeOverlayLiveSink: (sink: object) => {
		hubs.active.live.delete(sink);
	}
}));
vi.mock('@/lib/server/drain', () => ({
	onStreamsMove: (listener: () => void) => {
		hubs.moves.push(listener);
		return () => {
			const index = hubs.moves.indexOf(listener);
			if (index >= 0) hubs.moves.splice(index, 1);
		};
	}
}));

type Loader = () => Promise<ApiRouteModule>;
type Hub = keyof typeof hubs.active;
const held = () => Object.values(hubs.active).reduce((sum, set) => sum + set.size, 0);

const KICK = '/api/kick/realtime?channelId=668&chatroomId=669';
const YOUTUBE = '/api/youtube/stream?channel=%40mrbeast';
const TIKTOK = '/api/tiktok/chat?user=gxufy';
const LIVE = '/api/overlay/live?c=twitch%3Agxufy';
const mux = (...subs: string[]) =>
	'/api/overlay/stream?' + subs.map((sub, index) => `s=${encodeURIComponent(`k${index}||${sub}`)}`).join('&');

const STREAMS: Record<string, { load: Loader; path: string; hubs: Hub[]; moveMark: string | null }> = {
	'/api/overlay/live': { load: () => import('@/api/overlay/live'), path: LIVE, hubs: ['live'], moveMark: 'retry: 500' },
	'/api/kick/realtime': { load: () => import('@/api/kick/realtime'), path: KICK, hubs: ['kick'], moveMark: null },
	'/api/youtube/stream': { load: () => import('@/api/youtube/stream'), path: YOUTUBE, hubs: ['youtube'], moveMark: '{"type":"moving"}' },
	'/api/tiktok/chat': { load: () => import('@/api/tiktok/chat'), path: TIKTOK, hubs: ['tiktok'], moveMark: '{"type":"moving"}' },
	'/api/overlay/stream': {
		load: () => import('@/api/overlay/stream'),
		path: mux(LIVE, KICK, YOUTUBE, TIKTOK),
		hubs: ['live', 'kick', 'youtube', 'tiktok'],
		moveMark: '*\t.move'
	}
};

const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);

type Server = { port: number; close: () => Promise<void> };

function listen(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				port,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections();
						server.close(() => done());
					})
			});
		});
	});
}

async function serve(load: Loader): Promise<Server> {
	vi.resetModules();
	const route = await load();
	return listen(async (req, res) => {
		const request = getRequest({ request: req, response: res, base: 'http://localhost' });
		const event = {
			request,
			url: new URL(request.url),
			getClientAddress: () => req.socket.remoteAddress ?? '',
			platform: { req }
		} as unknown as RequestEvent;
		await setResponse(res, await runApiRoute(route, event));
	});
}

type Stream = {
	status: number;
	headers: Record<string, string>;
	text: () => string;
	ended: Promise<void>;
	until: (mark: string, ms?: number) => Promise<string>;
	leave: () => void;
};

function open(port: number, path: string): Promise<Stream> {
	return new Promise((resolve, reject) => {
		let req: ClientRequest | null = null;
		req = httpRequest({ host: '127.0.0.1', port, path, agent: false }, (res) => {
			let body = '';
			const waiters: Array<() => void> = [];
			res.setEncoding('utf8');
			res.on('data', (chunk: string) => {
				body += chunk;
				for (const wake of waiters.splice(0)) wake();
			});
			const ended = new Promise<void>((done) => res.on('end', () => done()));
			const headers: Record<string, string> = {};
			for (const [key, value] of Object.entries(res.headers)) {
				if (!IGNORED_HEADERS.has(key) && value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
			}
			resolve({
				status: res.statusCode ?? 0,
				headers,
				text: () => body,
				ended,
				until: (mark, ms = 2_000) =>
					new Promise((done, fail) => {
						const timer = setTimeout(() => fail(new Error(`no "${mark}" in ${JSON.stringify(body)}`)), ms);
						const check = () => {
							if (body.includes(mark)) {
								clearTimeout(timer);
								done(body);
							} else waiters.push(check);
						};
						check();
					}),
				leave: () => req?.destroy()
			});
		});
		req.on('error', (error) => {
			if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
		});
		req.end();
	});
}

async function settle(check: () => boolean, ms = 2_000): Promise<void> {
	const until = Date.now() + ms;
	while (!check()) {
		if (Date.now() > until) throw new Error('timed out');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/* What a stream says before anything happens: its retry hint, the hub's first
   status, and (for the combined stream) every sub-stream's open frame. */
const FIRST: Record<string, string> = {
	'/api/overlay/live': '"now":5}\n\n',
	'/api/kick/realtime': '"connecting"}\n\n',
	'/api/youtube/stream': '"connecting"}\n\n',
	'/api/tiktok/chat': '"connecting"}\n\n',
	'/api/overlay/stream': 'k3\tmessage'
};

beforeEach(() => {
	hubs.moves.length = 0;
});

/* Each test leaves nothing held (a stream that never lets go fails here). */
afterEach(async () => {
	vi.restoreAllMocks();
	await settle(() => held() === 0);
});

describe('the long-lived streams', () => {
	for (const [name, stream] of Object.entries(STREAMS)) {
		describe(name, () => {
			it('opens with its status, headers and first events', async () => {
				const server = await serve(stream.load);
				const opened = await open(server.port, stream.path);
				const first = await opened.until(FIRST[name]!);
				const answer = { status: opened.status, headers: opened.headers, first: first.slice(0, first.indexOf(FIRST[name]!) + FIRST[name]!.length) };
				opened.leave();
				await server.close();
				expect(answer).toMatchSnapshot();
				expect(answer.status).toBe(200);
				expect(answer.headers['content-type']).toBe('text/event-stream');
				/* Caddy compresses nothing marked no-transform. */
				expect(answer.headers['cache-control']).toBe('no-cache, no-transform');
			});

			it('lets go of its hub subscriptions when the viewer leaves', async () => {
				const server = await serve(stream.load);
				const opened = await open(server.port, stream.path);
				await opened.until(FIRST[name]!);
				for (const hub of stream.hubs) expect(hubs.active[hub].size, hub).toBe(1);
				opened.leave();
				await settle(() => held() === 0);
				/* Nor does it keep waiting for a handover. */
				expect(hubs.moves).toHaveLength(0);
				await server.close();
			});

			if (stream.moveMark) {
				it('sends its move message and ends when a deploy hands over', async () => {
					const server = await serve(stream.load);
					const opened = await open(server.port, stream.path);
					await opened.until(FIRST[name]!);
					expect(hubs.moves.length).toBeGreaterThan(0);
					for (const move of hubs.moves.splice(0)) move();
					await opened.until(stream.moveMark!);
					await Promise.race([
						opened.ended,
						new Promise((_, fail) => setTimeout(() => fail(new Error('the response did not end')), 2_000))
					]);
					await settle(() => held() === 0);
					await server.close();
				});
			}
		});
	}

	it('resumes a Kick sub-stream from the event id the browser sends back', async () => {
		const calls: unknown[][] = [];
		const kick = await import('@/lib/server/kickRealtimeHub');
		vi.spyOn(kick, 'subscribeKickRealtime').mockImplementation((...args: unknown[]) => {
			calls.push(args);
			return () => undefined;
		});
		const server = await serve(STREAMS['/api/overlay/stream']!.load);
		const path = '/api/overlay/stream?s=' + encodeURIComponent(`kick|41|${KICK}`);
		const opened = await open(server.port, path);
		await opened.until('kick\t.open');
		expect(calls.at(-1)?.at(-1)).toBe(41);
		opened.leave();
		await server.close();
	});
});
