/*
 * Test helper (used by the *.spec.ts files only): an API route from
 * app/src/api served over real HTTP the way this app serves it (apiRoute
 * behind SvelteKit's getRequest/setResponse). Each server loads its own copy
 * of the route's modules, so its own caches and limits.
 */
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { vi } from 'vitest';
import { runApiRoute, type ApiRouteModule } from './apiRoute.ts';

export type Loader = () => Promise<ApiRouteModule>;
/* `body` as text; `sha256` of the exact bytes (for audio). */
export type Answer = { status: number; headers: Record<string, string>; cookies: string[]; body: string; sha256: string };
export type Call = { method?: string; path: string; headers?: Record<string, string>; body?: string };
export type Server = { port: number; close: () => Promise<void> };

const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding', 'set-cookie']);

function listen(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
		});
	});
}

/** A fresh copy of a route. */
export async function serve(load: Loader): Promise<Server> {
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

export function send(server: Server, call: Call): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: '127.0.0.1', port: server.port, method: call.method ?? 'GET', path: call.path, headers: call.headers },
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const bytes = Buffer.concat(chunks);
					const headers: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						if (!IGNORED_HEADERS.has(key) && value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
					}
					/* Node chunks a write() + end(); SvelteKit sends a Content-Length. */
					if (res.headers['transfer-encoding'] === 'chunked') headers['content-length'] = String(bytes.length);
					resolve({
						status: res.statusCode ?? 0,
						headers,
						cookies: res.headers['set-cookie'] ?? [],
						body: bytes.toString(),
						sha256: createHash('sha256').update(bytes).digest('hex')
					});
				});
			}
		);
		req.on('error', reject);
		if (call.body) req.write(call.body);
		req.end();
	});
}

/** One request to a fresh copy of the route. */
export async function once(load: Loader, call: Call): Promise<Answer> {
	const server = await serve(load);
	try {
		return await send(server, call);
	} finally {
		await server.close();
	}
}
