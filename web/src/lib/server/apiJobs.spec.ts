import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDrainForTests } from '@/lib/server/drain';
import { serve, send, type Answer, type Call, type Loader } from './routeServer.ts';

/*
 * The overlay usage reports (/api/overlay/usage) and the public health check
 * (/api/runtime/health). Usage requests run as a sequence on a fresh copy of
 * the route (its own limits and repeat check); the answers and the Discord
 * messages sent are snapshots of what the Next.js app gave (this app was
 * checked against it, request for request, before it was retired). The clock
 * is held still, so the messages' times stay the same.
 */

const USAGE: Loader = () => import('@/api/overlay/usage');
const HEALTH: Loader = () => import('@/api/runtime/health');
const HOOK = 'https://discord.com/api/webhooks/123456789/parity-usage-hook-0123456789abcdef';
const ABUSE_HOOK = 'https://discord.com/api/webhooks/123456789/parity-abuse-hook-0123456789abcdef';
const NOW = Date.parse('2026-11-26T15:00:00Z');
const SITE = 'https://flosschat.app';

let n = 0;
const eventId = () => `0b3f6e2a-1c4d-4e5f-8a9b-${String(++n).padStart(12, '0')}`;
const chat = (id = eventId()) => ({
	eventId: id,
	overlay: 'multichat',
	action: 'opened',
	channels: [
		{ platform: 'twitch', channel: 'gxufy' },
		{ platform: 'kick', channel: 'gxufy' }
	],
	instanceId: '0a1b2c3d'
});
const post = (body: unknown, headers: Record<string, string> = {}): Call => ({
	method: 'POST',
	path: '/api/overlay/usage',
	headers: { 'Content-Type': 'application/json', Origin: SITE, ...headers },
	body: typeof body === 'string' ? body : JSON.stringify(body)
});

type Sent = { url: string; body: unknown };

/* The answers to the calls, and what was sent to Discord. */
async function sequence(calls: Call[], env: Record<string, string> = { GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: HOOK }) {
	for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
	const sent: Sent[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? 'null')) });
			return new Response(null, { status: 204 });
		})
	);
	const server = await serve(USAGE);
	const answers: Answer[] = [];
	try {
		for (const call of calls) answers.push(await send(server, call));
		/* The abuse alert is queued, then sent a moment later. */
		await new Promise((resolve) => setTimeout(resolve, 50));
	} finally {
		await server.close();
	}
	vi.unstubAllEnvs();
	return { answers, sent };
}

beforeEach(() => {
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('/api/overlay/usage', () => {
	it('sends one Discord message per overlay event, and none for a repeat', async () => {
		const id = eventId();
		const counter = { ...chat(), overlay: 'counter', combined: true };
		const web = await sequence([post(chat(id)), post(chat(id)), post(counter)]);
		expect(web.answers).toMatchSnapshot();
		expect(web.sent).toMatchSnapshot();
		expect(web.answers.map((answer) => answer.status)).toEqual([204, 204, 204]);
		expect(web.sent.map((message) => message.url)).toEqual([HOOK, HOOK]);
	});

	it('refuses what is not an overlay event', async () => {
		const calls = [
			post({ ...chat(), overlay: 'something' }),
			post({ ...chat(), extra: 1 }),
			post({ ...chat(), channels: [] }),
			post('{not json'),
			post(chat(), { Origin: 'https://elsewhere.example' }),
			post({ ...chat(), padding: 'x'.repeat(2100) }),
			{ method: 'GET', path: '/api/overlay/usage' },
			{ method: 'PUT', path: '/api/overlay/usage', headers: { 'Content-Type': 'application/json', Origin: SITE }, body: '{}' }
		];
		const web = await sequence(calls);
		expect(web.answers).toMatchSnapshot();
		expect(web.answers.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 403, 413, 405, 405]);
		expect(web.sent).toEqual([]);
	});

	it('takes a report with no Origin', async () => {
		const web = await sequence([post(chat(), { Origin: '' })]);
		expect(web.answers).toMatchSnapshot();
		expect(web.answers[0].status).toBe(204);
		expect(web.sent).toMatchSnapshot();
	});

	it('limits one visitor, with one abuse alert', async () => {
		/* 12 reports in 10 minutes, then refusals; the third refusal in a
		   minute raises the abuse alert. */
		const calls = Array.from({ length: 15 }, () => post(chat()));
		const web = await sequence(calls, {
			GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: HOOK,
			GXUFY_ABUSE_DISCORD_WEBHOOK_URL: ABUSE_HOOK
		});
		expect(web.answers).toMatchSnapshot();
		expect(web.answers.map((answer) => answer.status)).toEqual([...Array(12).fill(204), 429, 429, 429]);
		expect(web.answers[12].headers['retry-after']).toBe('600');
		expect(web.sent).toMatchSnapshot();
		expect(web.sent.filter((message) => message.url === ABUSE_HOOK)).toHaveLength(1);
	});

	it('answers with no webhook set, and says so in the log', async () => {
		const warn = vi.mocked(console.warn);
		const web = await sequence([post(chat())], {});
		expect(web.answers).toMatchSnapshot();
		expect(web.answers[0].status).toBe(204);
		expect(web.sent).toEqual([]);
		/* The line the deploy looks for. */
		expect(warn.mock.calls.filter(([line]) => line === 'Discord overlay-usage delivery is not configured.')).toHaveLength(1);
	});

	it('logs a failed delivery', async () => {
		const error = vi.mocked(console.error);
		vi.stubEnv('GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL', HOOK);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
		const server = await serve(USAGE);
		try {
			expect((await send(server, post(chat()))).status).toBe(204);
		} finally {
			await server.close();
		}
		expect(error.mock.calls.filter(([line]) => line === 'Discord overlay-usage delivery failed.')).toHaveLength(1);
	});
});

describe('/api/runtime/health', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'fc-health-'));
	const hold = path.join(dir, 'a.hold');
	const drain = path.join(dir, 'a.draining');

	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	async function answer(call: Call): Promise<Answer> {
		vi.stubEnv('FLOSSCHAT_HOLD_FILE', hold);
		vi.stubEnv('FLOSSCHAT_DRAIN_FILE', drain);
		__resetDrainForTests();
		const server = await serve(HEALTH);
		try {
			return await send(server, call);
		} finally {
			await server.close();
		}
	}

	it('is ok while this copy takes visitors', async () => {
		rmSync(hold, { force: true });
		rmSync(drain, { force: true });
		const web = await answer({ path: '/api/runtime/health' });
		expect(web).toMatchSnapshot();
		expect(web.status).toBe(200);
		expect(JSON.parse(web.body)).toEqual({ status: 'ok' });
	});

	it('says held, then draining, during a deploy', async () => {
		writeFileSync(hold, '');
		const held = await answer({ path: '/api/runtime/health' });
		expect(held).toMatchSnapshot();
		expect([held.status, JSON.parse(held.body)]).toEqual([503, { status: 'held' }]);
		rmSync(hold, { force: true });
		writeFileSync(drain, '');
		const draining = await answer({ path: '/api/runtime/health' });
		expect(draining).toMatchSnapshot();
		expect([draining.status, JSON.parse(draining.body)]).toEqual([503, { status: 'draining' }]);
		rmSync(drain, { force: true });
	});

	for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
		it(`answers ${method}`, async () => {
			const call = method === 'POST'
				? { method, path: '/api/runtime/health', headers: { 'Content-Type': 'application/json' }, body: '{}' }
				: { method, path: '/api/runtime/health' };
			const web = await answer(call);
			expect(web).toMatchSnapshot();
			expect(web.status).toBe(405);
		});
	}
});
