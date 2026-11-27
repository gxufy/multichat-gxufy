import { EventEmitter } from 'node:events';
import { decode as decodeFormBody } from 'node:querystring';
import { Readable, Stream } from 'node:stream';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

/*
 * Runs an API route from app/src/api (a Node-style req/res handler) as a
 * SvelteKit endpoint. The handlers were written for Next.js's API routes, and
 * everything Next.js did around a handler is done the same way here
 * (next/dist/server/api-utils/node/api-resolver.js), so they answer as they
 * always have:
 *   - req: method, url, headers, query (repeated keys become arrays), cookies,
 *     and the body parsed as Next parses it (JSON, form, or text; 1 MB unless
 *     the route's `config.api.bodyParser` says otherwise; `false` leaves the
 *     raw body to read from req as a stream).
 *   - res: status(), setHeader(), json(), send(), redirect(), write(), end():
 *     the same content types, Content-Length and ETag (a matching
 *     If-None-Match answers 304), 204/304 without a body.
 *   - a handler that throws answers 500 "Internal Server Error" (or the status
 *     of a body that couldn't be read).
 * The client address is the one this app was told to trust (event.getClientAddress:
 * adapter-node's ADDRESS_HEADER behind Caddy), given to the handler as the
 * request's socket address, which is what the shared client-identity code reads
 * when it isn't told to trust a forwarding header itself.
 * A route file is then two lines:
 *   import * as route from '@/api/...';
 *   export const fallback = apiRoute(route);
 * (`fallback` takes every method, so the handler decides, 405s included.)
 */

type Handler = (req: ApiRequest, res: ApiResponse) => unknown;
/* As Next reads it: false leaves the body unread, true or an object parses it. */
type BodyParserConfig = boolean | { sizeLimit?: string | number } | undefined;
export type ApiRouteModule = {
	default: Handler;
	config?: { api?: { bodyParser?: BodyParserConfig; responseLimit?: unknown } };
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_BODY_LIMIT = '1mb';
const encoder = new TextEncoder();

class ApiError extends Error {
	constructor(
		readonly statusCode: number,
		message: string
	) {
		super(message);
	}
}

/* ---- What Next computes, ported as-is ---------------------------------- */

/** FNV-1a 52-bit (next/dist/server/lib/etag.js). */
function fnv1a52(str: string): number {
	const len = str.length;
	let i = 0,
		t0 = 0,
		v0 = 0x2325,
		t1 = 0,
		v1 = 0x8422,
		t2 = 0,
		v2 = 0x9ce4,
		t3 = 0,
		v3 = 0xcbf2;
	while (i < len) {
		v0 ^= str.charCodeAt(i++);
		t0 = v0 * 435;
		t1 = v1 * 435;
		t2 = v2 * 435;
		t3 = v3 * 435;
		t2 += v0 << 8;
		t3 += v1 << 8;
		t1 += t0 >>> 16;
		v0 = t0 & 65535;
		t2 += t1 >>> 16;
		v1 = t1 & 65535;
		v3 = (t3 + (t2 >>> 16)) & 65535;
		v2 = t2 & 65535;
	}
	return (v3 & 15) * 281474976710656 + v2 * 4294967296 + v1 * 65536 + (v0 ^ (v3 >> 4));
}

export function generateETag(payload: string): string {
	return '"' + fnv1a52(payload).toString(36) + payload.length.toString(36) + '"';
}

/** The `fresh` check Next uses for If-None-Match / If-Modified-Since. */
function isFresh(headers: Record<string, string | string[] | undefined>, etag: string): boolean {
	const modifiedSince = headers['if-modified-since'];
	const noneMatch = headers['if-none-match'];
	if (!modifiedSince && !noneMatch) return false;
	const cacheControl = headers['cache-control'];
	if (typeof cacheControl === 'string' && /(?:^|,)\s*?no-cache\s*?(?:,|$)/.test(cacheControl)) return false;
	if (typeof noneMatch === 'string' && noneMatch !== '*') {
		const tags = noneMatch.split(',').map((tag) => tag.trim());
		if (!tags.some((tag) => tag === etag || tag === 'W/' + etag || 'W/' + tag === etag)) return false;
	}
	if (modifiedSince) return false; /* no Last-Modified is ever set here */
	return true;
}

/** "1mb", "500kb", or a number of bytes (the `bytes` package's units). */
function byteLimit(limit: string | number): number {
	if (typeof limit === 'number') return limit;
	const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(limit);
	if (!match) return 1024 * 1024;
	const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
	return Math.floor(Number(match[1]) * units[(match[2] ?? 'b').toLowerCase()]);
}

function mediaType(header: string | null): { type: string; charset: string } {
	const [rawType = '', ...params] = (header || 'text/plain').split(';');
	const type = rawType.trim().toLowerCase();
	if (!/^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/.test(type)) {
		return { type: 'text/plain', charset: 'utf-8' };
	}
	let charset = 'utf-8';
	for (const param of params) {
		const [name, ...value] = param.split('=');
		if (name?.trim().toLowerCase() === 'charset') {
			charset = value.join('=').trim().replace(/^"(.*)"$/, '$1') || 'utf-8';
		}
	}
	return { type, charset };
}

/**
 * The request body for a route that reads it itself (bodyParser: false). A
 * handler that stops reading early (a size cap of its own, as the Stripe
 * webhook has) ends its loop, which destroys this stream; the rest of the
 * body is then read and thrown away instead of cancelled, so the connection
 * stays up and the answer goes out, as on Next.
 */
function rawBodyStream(body: ReadableStream<Uint8Array>): Readable {
	const reader = body.getReader();
	let finished = false;
	return new Readable({
		async read() {
			try {
				const result = await reader.read();
				if (result.done) {
					finished = true;
					this.push(null);
				} else {
					this.push(Buffer.from(result.value));
				}
			} catch (error) {
				finished = true;
				this.destroy(error as Error);
			}
		},
		destroy(error, callback) {
			if (!finished) {
				finished = true;
				void (async () => {
					try {
						while (!(await reader.read()).done) {
							/* discarded */
						}
					} catch {
						/* the visitor went away */
					}
				})();
			}
			callback(error);
		}
	});
}

async function readBody(request: Request, limitSetting: string | number): Promise<unknown> {
	const { type, charset } = mediaType(request.headers.get('content-type'));
	const limit = byteLimit(limitSetting);
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (request.body) {
		/* Read by hand: leaving a for-await loop early would cancel the body and
		   drop the connection, where Next answers 413 and the rest of the body is
		   simply discarded. */
		const reader = request.body.getReader();
		for (;;) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch {
				throw new ApiError(400, 'Invalid body');
			}
			if (result.done) break;
			size += result.value.byteLength;
			if (size > limit) {
				reader.releaseLock();
				throw new ApiError(413, `Body exceeded ${limitSetting} limit`);
			}
			chunks.push(result.value);
		}
	}
	let text: string;
	try {
		text = new TextDecoder(charset).decode(Buffer.concat(chunks));
	} catch {
		throw new ApiError(400, 'Invalid body');
	}
	if (type === 'application/json' || type === 'application/ld+json') {
		if (text.length === 0) return {};
		try {
			return JSON.parse(text);
		} catch {
			throw new ApiError(400, 'Invalid JSON');
		}
	}
	if (type === 'application/x-www-form-urlencoded') return decodeFormBody(text);
	return text;
}

function parseCookies(header: string | undefined): Record<string, string> {
	const cookies: Record<string, string> = {};
	if (!header) return cookies;
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		const name = part.slice(0, index).trim();
		if (!name || name in cookies) continue;
		let value = part.slice(index + 1).trim();
		if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
		try {
			cookies[name] = value.includes('%') ? decodeURIComponent(value) : value;
		} catch {
			cookies[name] = value;
		}
	}
	return cookies;
}

function queryOf(url: URL): Record<string, string | string[]> {
	const query: Record<string, string | string[]> = {};
	for (const key of new Set(url.searchParams.keys())) {
		const values = url.searchParams.getAll(key);
		query[key] = values.length > 1 ? values : values[0];
	}
	return query;
}

/* ---- The response ------------------------------------------------------ */

type HeaderValue = string | number | readonly string[];

class HandlerResponse extends EventEmitter {
	statusCode = 200;
	statusMessage = '';
	headersSent = false;
	writableEnded = false;
	finished = false;
	private readonly headerMap = new Map<string, [string, HeaderValue]>();
	private controller!: ReadableStreamDefaultController<Uint8Array>;
	private resolveStarted!: () => void;
	readonly started = new Promise<void>((resolve) => (this.resolveStarted = resolve));
	readonly body = new ReadableStream<Uint8Array>({
		start: (controller) => {
			this.controller = controller;
		},
		cancel: () => {
			this.writableEnded = true;
			this.emit('close');
		}
	});

	constructor(private readonly req: ApiRequest) {
		super();
	}

	private assertHeadersOpen(): void {
		if (this.headersSent) {
			const error = new Error('Cannot set headers after they are sent to the client') as Error & { code: string };
			error.code = 'ERR_HTTP_HEADERS_SENT';
			throw error;
		}
	}

	setHeader(name: string, value: HeaderValue): this {
		this.assertHeadersOpen();
		this.headerMap.set(name.toLowerCase(), [name, value]);
		return this;
	}

	appendHeader(name: string, value: string | readonly string[]): this {
		const current = this.getHeader(name);
		const next = [
			...(current === undefined ? [] : Array.isArray(current) ? current : [String(current)]),
			...(Array.isArray(value) ? value : [value as string])
		];
		return this.setHeader(name, next);
	}

	getHeader(name: string): HeaderValue | undefined {
		return this.headerMap.get(name.toLowerCase())?.[1];
	}

	getHeaders(): Record<string, HeaderValue> {
		return Object.fromEntries([...this.headerMap].map(([key, [, value]]) => [key, value]));
	}

	getHeaderNames(): string[] {
		return [...this.headerMap.keys()];
	}

	hasHeader(name: string): boolean {
		return this.headerMap.has(name.toLowerCase());
	}

	removeHeader(name: string): void {
		this.assertHeadersOpen();
		this.headerMap.delete(name.toLowerCase());
	}

	writeHead(statusCode: number, ...rest: unknown[]): this {
		this.assertHeadersOpen();
		this.statusCode = statusCode;
		const [first, second] = rest;
		const headers = typeof first === 'string' ? second : first;
		if (typeof first === 'string') this.statusMessage = first;
		if (headers && typeof headers === 'object') {
			for (const [key, value] of Object.entries(headers as Record<string, HeaderValue>)) {
				if (value !== undefined) this.setHeader(key, value);
			}
		}
		/* Node fixes the status and headers here (headersSent is true after it). */
		this.start();
		return this;
	}

	flushHeaders(): void {
		this.start();
	}

	/** The status and headers as they were when the body started. */
	responseInit(): { status: number; headers: Headers } {
		const headers = new Headers();
		for (const [, [name, value]] of this.headerMap) {
			if (Array.isArray(value)) for (const item of value) headers.append(name, String(item));
			else headers.set(name, String(value));
		}
		return { status: this.statusCode, headers };
	}

	private start(): void {
		if (this.headersSent) return;
		this.headersSent = true;
		this.resolveStarted();
	}

	private chunk(data: unknown, encoding?: unknown): Uint8Array | null {
		if (data === undefined || data === null || typeof data === 'function') return null;
		if (typeof data === 'string') {
			return typeof encoding === 'string' && encoding !== 'utf8' && encoding !== 'utf-8'
				? Buffer.from(data, encoding as BufferEncoding)
				: encoder.encode(data);
		}
		if (data instanceof Uint8Array) return data;
		throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array');
	}

	write(data: unknown, encoding?: unknown, callback?: unknown): boolean {
		if (this.writableEnded) return false;
		const bytes = this.chunk(data, encoding);
		this.start();
		if (bytes && bytes.byteLength) this.controller.enqueue(bytes);
		const done = typeof encoding === 'function' ? encoding : callback;
		if (typeof done === 'function') queueMicrotask(() => (done as () => void)());
		return true;
	}

	end(data?: unknown, encoding?: unknown, callback?: unknown): this {
		if (this.writableEnded) return this;
		const bytes = this.chunk(data, encoding);
		this.start();
		if (bytes && bytes.byteLength) this.controller.enqueue(bytes);
		this.writableEnded = true;
		this.finished = true;
		try {
			this.controller.close();
		} catch {
			/* already closed by the client going away */
		}
		const done = [data, encoding, callback].find((arg) => typeof arg === 'function');
		queueMicrotask(() => {
			if (typeof done === 'function') (done as () => void)();
			this.emit('finish');
			this.emit('close');
		});
		return this;
	}

	/* What Next adds to every API response object. */

	status(statusCode: number): this {
		this.statusCode = statusCode;
		return this;
	}

	send(body: unknown): void {
		if (body === null || body === undefined) {
			this.end();
			return;
		}
		if (this.statusCode === 204 || this.statusCode === 304) {
			this.removeHeader('Content-Type');
			this.removeHeader('Content-Length');
			this.removeHeader('Transfer-Encoding');
			this.end();
			return;
		}
		const contentType = this.getHeader('Content-Type');
		if (body instanceof Stream) {
			if (!contentType) this.setHeader('Content-Type', 'application/octet-stream');
			body.on('data', (chunk) => this.write(chunk));
			body.on('end', () => this.end());
			body.on('error', () => this.end());
			return;
		}
		/* As Next does it: a Buffer counts as "object" too, so its ETag is the
		   one of its JSON form, while the bytes themselves are what's sent. */
		const isJsonLike = ['object', 'number', 'boolean'].includes(typeof body);
		const text = isJsonLike ? JSON.stringify(body) : String(body);
		const etag = generateETag(text);
		this.setHeader('ETag', etag);
		if (isFresh(this.req.headers, etag)) {
			this.statusCode = 304;
			this.end();
			return;
		}
		if (Buffer.isBuffer(body)) {
			if (!contentType) this.setHeader('Content-Type', 'application/octet-stream');
			this.setHeader('Content-Length', body.length);
			this.end(body);
			return;
		}
		if (isJsonLike) this.setHeader('Content-Type', JSON_CONTENT_TYPE);
		this.setHeader('Content-Length', Buffer.byteLength(text));
		this.end(text);
	}

	json(body: unknown): void {
		this.setHeader('Content-Type', JSON_CONTENT_TYPE);
		this.send(JSON.stringify(body));
	}

	redirect(statusOrUrl: number | string, url?: string): this {
		const status = typeof statusOrUrl === 'string' ? 307 : statusOrUrl;
		const location = typeof statusOrUrl === 'string' ? statusOrUrl : url;
		if (typeof status !== 'number' || typeof location !== 'string') {
			throw new Error('Invalid redirect arguments.');
		}
		this.writeHead(status, { Location: location });
		this.write(location);
		this.end();
		return this;
	}

	setDraftMode(): never {
		throw new Error('Draft mode is not available here.');
	}

	setPreviewData(): never {
		throw new Error('Preview data is not available here.');
	}

	clearPreviewData(): never {
		throw new Error('Preview data is not available here.');
	}

	revalidate(): Promise<never> {
		return Promise.reject(new Error('Revalidation is not available here.'));
	}
}

/* ---- The endpoint ------------------------------------------------------ */

function clientAddress(event: RequestEvent): string {
	try {
		return event.getClientAddress();
	} catch {
		return '';
	}
}

function sendError(res: HandlerResponse, statusCode: number, message: string): void {
	if (res.writableEnded) return;
	if (!res.headersSent) {
		res.statusCode = statusCode;
		res.statusMessage = message;
	}
	res.end(message);
}

export async function runApiRoute(route: ApiRouteModule, event: RequestEvent): Promise<Response> {
	const request = event.request;
	const url = new URL(request.url);
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});
	const bodyParser = route.config?.api?.bodyParser;
	const parseBody = bodyParser !== false;

	const stream = !parseBody && request.body ? rawBodyStream(request.body) : Readable.from([]);
	const socket = { remoteAddress: clientAddress(event) };
	const req = Object.assign(stream, {
		method: request.method,
		url: url.pathname + url.search,
		headers,
		query: queryOf(url),
		cookies: parseCookies(headers.cookie),
		body: undefined as unknown,
		socket,
		connection: socket
	}) as unknown as ApiRequest;
	const res = new HandlerResponse(req);
	request.signal?.addEventListener('abort', () => {
		req.emit('close');
		if (!res.writableEnded) res.emit('close');
	});

	const run = (async () => {
		if (parseBody) {
			const limit = (bodyParser && typeof bodyParser === 'object' && bodyParser.sizeLimit) || DEFAULT_BODY_LIMIT;
			(req as { body: unknown }).body = await readBody(request, limit);
		}
		await route.default(req, res as unknown as ApiResponse);
	})().catch((error: unknown) => {
		if (error instanceof ApiError) {
			sendError(res, error.statusCode, error.message);
			return;
		}
		console.error(error);
		sendError(res, 500, 'Internal Server Error');
	});

	await Promise.race([res.started, run.then(() => res.started)]);
	const { status, headers: responseHeaders } = res.responseInit();
	const noBody = request.method === 'HEAD' || status === 204 || status === 304;
	if (noBody) void res.body.cancel().catch(() => undefined);
	return new Response(noBody ? null : res.body, { status, headers: responseHeaders });
}

/** A SvelteKit request handler that runs the API route `route`. */
export function apiRoute(route: ApiRouteModule): RequestHandler {
	return (event) => runApiRoute(route, event);
}
