import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPublicDir } from '@/lib/server/appPublicDir';
import { __resetPayPalRecheckForTests, payPalRechecksRunning } from '@/lib/server/paypalRecheck';
import { stopStreamHandover } from '@/lib/server/streamHandover';
import { handle, init } from './hooks.server.ts';

type Event = Parameters<typeof handle>[0]['event'];

async function run(url: string, host: string, page = new Response('page')) {
	const u = new URL(url);
	const event = { url: u, request: new Request(u, { headers: { host } }) } as unknown as Event;
	return handle({ event, resolve: async () => page });
}

describe('handle', () => {
	it('forwards the old domain to the gxufy.com homepage, query kept', async () => {
		const res = await run('https://multichat-gxufy.com/?a=1', 'multichat-gxufy.com');
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe('https://gxufy.com/?a=1');
	});

	it('serves gxufy.com/ in place with the security headers', async () => {
		const res = await run('https://gxufy.com/', 'gxufy.com');
		expect(res.status).toBe(200);
		expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
	});

	it('never moves an overlay URL', async () => {
		const res = await run('https://multichat-gxufy.com/?channel=gxufy', 'multichat-gxufy.com');
		expect(res.status).toBe(200);
	});

	it('answers a public file before any page, on every domain, with the security headers', async () => {
		const robots = readFileSync(join(appPublicDir(), 'robots.txt'));
		for (const host of ['flosschat.app', 'gxufy.com', 'multichat-gxufy.com']) {
			const res = await run(`https://${host}/robots.txt`, host, new Response('page', { status: 404 }));
			expect(res.status, host).toBe(200);
			expect(res.headers.get('content-type'), host).toBe('text/plain; charset=UTF-8');
			expect(res.headers.get('cache-control'), host).toBe('public, max-age=0');
			expect(res.headers.get('strict-transport-security'), host).toBe('max-age=31536000');
			expect(res.headers.get('x-content-type-options'), host).toBe('nosniff');
			expect(res.headers.get('x-frame-options'), host).toBeNull();
			expect(Buffer.from(await res.arrayBuffer()).equals(robots), host).toBe(true);
		}
	});

	it('leaves every other path to the pages', async () => {
		const res = await run('https://flosschat.app/badges', 'flosschat.app');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('page');
	});

	it('still forwards a tool page to flosschat.app first', async () => {
		const res = await run('https://gxufy.com/tools/multichat', 'gxufy.com');
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe('https://flosschat.app/tools/multichat');
	});

	it('tells browsers and Cloudflare never to keep an error page', async () => {
		const html = { 'content-type': 'text/html' };
		const missing = await run('https://flosschat.app/badges/nope.png', 'flosschat.app', new Response('<h1>404</h1>', { status: 404, headers: html }));
		expect(missing.status).toBe(404);
		expect(missing.headers.get('cache-control')).toBe('private, no-cache, no-store, max-age=0, must-revalidate');
		const failed = await run('https://flosschat.app/support', 'flosschat.app', new Response('<h1>500</h1>', { status: 500, headers: html }));
		expect(failed.headers.get('cache-control')).toBe('private, no-cache, no-store, max-age=0, must-revalidate');
	});

	it('leaves API answers, pages that say their own caching, and good pages alone', async () => {
		const api = await run('https://flosschat.app/api/jiltv/cosmetics', 'flosschat.app', new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }));
		expect(api.headers.get('cache-control')).toBeNull();
		const own = await run('https://flosschat.app/badges', 'flosschat.app', new Response('x', { status: 404, headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }));
		expect(own.headers.get('cache-control')).toBe('no-store');
		const good = await run('https://flosschat.app/badges', 'flosschat.app', new Response('x', { headers: { 'content-type': 'text/html' } }));
		expect(good.headers.get('cache-control')).toBeNull();
	});
});

describe('init', () => {
	afterEach(() => {
		__resetPayPalRecheckForTests();
		stopStreamHandover();
		vi.unstubAllEnvs();
	});

	it('notes the chats this copy serves, next to its drain file', async () => {
		const signals = mkdtempSync(join(tmpdir(), 'signals-'));
		try {
			vi.stubEnv('FLOSSCHAT_DRAIN_FILE', join(signals, 'b.draining'));
			vi.stubEnv('FLOSSCHAT_SLOT', 'b');
			await init();
			const written = JSON.parse(readFileSync(join(signals, 'b.streams.json'), 'utf8'));
			expect(written).toMatchObject({ kick: [], youtube: [], tiktok: [] });
		} finally {
			rmSync(signals, { recursive: true, force: true });
		}
	});

	it('writes nothing without a deploy slot', async () => {
		const signals = mkdtempSync(join(tmpdir(), 'signals-'));
		try {
			vi.stubEnv('FLOSSCHAT_DRAIN_FILE', join(signals, 'b.draining'));
			await init();
			expect(existsSync(join(signals, 'b.streams.json'))).toBe(false);
		} finally {
			rmSync(signals, { recursive: true, force: true });
		}
	});

	it('starts the PayPal check when the server starts', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		await init();
		expect(payPalRechecksRunning()).toBe(true);
	});

	it('leaves it off where it is switched off, and under tests', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('GXUFY_PAYPAL_RECHECK', 'off');
		await init();
		expect(payPalRechecksRunning()).toBe(false);
		vi.unstubAllEnvs();
		vi.stubEnv('NODE_ENV', 'test');
		await init();
		expect(payPalRechecksRunning()).toBe(false);
	});
});
