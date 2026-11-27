import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { generateETag, runApiRoute, type ApiRouteModule } from './apiRoute.ts';

/* What apiRoute does that a request over HTTP can't show; the answers
   themselves are held by apiRoutes.spec.ts. */

function event(request: Request, clientAddress: () => string = () => '203.0.113.7'): RequestEvent {
	return { request, url: new URL(request.url), getClientAddress: clientAddress } as unknown as RequestEvent;
}

const route = (handler: (req: ApiRequest, res: ApiResponse) => unknown): ApiRouteModule => ({
	default: handler
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('apiRoute', () => {
	it('gives the handler the address this app trusts, never a forwarding header it was sent', async () => {
		let seen = '';
		let key = '';
		const response = await runApiRoute(
			route((req, res) => {
				seen = req.socket.remoteAddress ?? '';
				key = resolveNodeClientKey(req);
				res.status(200).json({ ok: true });
			}),
			event(new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '198.51.100.9' } }))
		);
		expect(response.status).toBe(200);
		expect(seen).toBe('203.0.113.7');
		expect(key).toBe('203.0.113.7');

		/* Even if this app were told to trust the header, it only does so for a
		   loopback peer, which the trusted address never is here. */
		vi.stubEnv('TRUST_CADDY_PROXY', '1');
		await runApiRoute(
			route((req, res) => {
				key = resolveNodeClientKey(req);
				res.end();
			}),
			event(new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '198.51.100.9' } }))
		);
		expect(key).toBe('203.0.113.7');
	});

	it('an address it cannot work out counts as unknown, like anywhere else', async () => {
		let key = '';
		await runApiRoute(
			route((req, res) => {
				key = resolveNodeClientKey(req);
				res.end();
			}),
			event(new Request('http://localhost/api/x'), () => {
				throw new Error('no address header');
			})
		);
		expect(key).toBe('unknown');
	});

	it('tells the handler when the visitor goes away mid-stream', async () => {
		const controller = new AbortController();
		const closed = vi.fn();
		const response = await runApiRoute(
			route((req, res) => {
				req.on('close', closed);
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.write('data: hi\n\n');
			}),
			event(new Request('http://localhost/api/stream', { signal: controller.signal }))
		);
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		const reader = response.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: hi\n\n');
		controller.abort();
		expect(closed).toHaveBeenCalledTimes(1);
		void reader.cancel();
	});

	it('the body stream ending (the visitor gone) closes the response for the handler', async () => {
		const closed = vi.fn();
		const response = await runApiRoute(
			route((_req, res) => {
				res.on('close', closed);
				res.writeHead(200);
				res.write('a');
			}),
			event(new Request('http://localhost/api/stream'))
		);
		await response.body!.cancel();
		expect(closed).toHaveBeenCalled();
	});

	it('headers cannot change once the answer has started, as in Node', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let thrown: unknown;
		const response = await runApiRoute(
			route((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				try {
					res.setHeader('X-Late', '1');
				} catch (error) {
					thrown = error;
				}
				res.end('done');
			}),
			event(new Request('http://localhost/api/x'))
		);
		expect((thrown as { code?: string }).code).toBe('ERR_HTTP_HEADERS_SENT');
		expect(response.headers.has('x-late')).toBe(false);
		expect(await response.text()).toBe('done');
	});

	it('answers HEAD without a body', async () => {
		const response = await runApiRoute(
			route((_req, res) => res.status(200).json({ a: 1 })),
			event(new Request('http://localhost/api/x', { method: 'HEAD' }))
		);
		expect(response.status).toBe(200);
		expect(response.body).toBeNull();
		expect(response.headers.get('content-length')).toBe('7');
	});

	it('makes the same ETags as Next.js', () => {
		/* Next.js's own values (next/dist/server/lib/etag.js), so caches that
		   hold an answer from before keep matching. */
		expect(generateETag('')).toBe('"78p3gz236i0"');
		expect(generateETag('{}')).toBe('"bwc9mymkdm2"');
		expect(generateETag('{"a":1}')).toBe('"147uiiad94i7"');
		expect(generateETag('é ✓ 💜')).toBe('"13zvimxl48n6"');
		expect(generateETag('x'.repeat(5000))).toBe('"gkbk50ouxd3uw"');
	});
});
