/*
 * The site's public files (web/public: badge art, fonts, images, the
 * featured-streamer clips, robots.txt and sitemap.xml), answered the way the
 * Next.js app answered them (its public folder, served with the `send`
 * module), so browsers and caches saw no difference when it was retired: the
 * same Cache-Control, ETag, Last-Modified and content types, the same
 * conditional answers (304, 412) and byte ranges (206, 416). The tests hold
 * the answers Next's own file server gave.
 *
 * Production: src/hooks.server.ts answers these paths before any page.
 * Local dev, `vite preview` and the browser tests: vite.config.ts.
 *
 * Byte ranges matter for the clips: a browser can only jump around in a
 * video (seek bar, back/forward) when the server sends the part it asks for.
 * Without that, Chrome marks the clip as not seekable and every jump goes
 * back to the start.
 */
import { createReadStream, readdirSync, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

/*
 * send's content types (mime 1.6, which Next 16 uses) for the kinds of file
 * the folder holds, with send's charset rule (UTF-8 for text/*, JavaScript
 * and JSON). A test holds each (as Next's were) and checks that every file in
 * web/public has one here; anything else is application/octet-stream, as in
 * send.
 */
export const PUBLIC_FILE_TYPES: Readonly<Record<string, string>> = {
	'.avif': 'image/avif',
	'.css': 'text/css; charset=UTF-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=UTF-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'application/javascript; charset=UTF-8',
	'.json': 'application/json; charset=UTF-8',
	'.mp4': 'video/mp4',
	'.otf': 'font/otf',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=UTF-8',
	'.webm': 'video/webm',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.xml': 'application/xml'
};

const DEFAULT_TYPE = 'application/octet-stream';

/* What Next's error pages say about caching; its refusals here carry it too. */
const ERROR_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate';

export function publicFileType(file: string): string {
	return PUBLIC_FILE_TYPES[extname(file).toLowerCase()] ?? DEFAULT_TYPE;
}

/* ---- Byte ranges: range-parser 1.2, as send uses it. ---- */

export type ByteRange = { start: number; end: number };

/**
 * The ranges a `Range` header asks for in a file of `size` bytes: -2 for a
 * header that isn't a range at all, -1 when no range is satisfiable. With
 * `combine`, overlapping and adjacent ranges are merged.
 */
export function parseRange(size: number, header: string, options?: { combine?: boolean }): ByteRange[] | -1 | -2 {
	const index = header.indexOf('=');
	if (index === -1) return -2;
	const ranges: ByteRange[] = [];
	for (const part of header.slice(index + 1).split(',')) {
		const bounds = part.split('-');
		let start = parseInt(bounds[0], 10);
		let end = parseInt(bounds[1], 10);
		if (isNaN(start)) {
			/* bytes=-500: the last 500 bytes. */
			start = size - end;
			end = size - 1;
		} else if (isNaN(end)) {
			end = size - 1;
		}
		if (end > size - 1) end = size - 1;
		if (isNaN(start) || isNaN(end) || start > end || start < 0) continue;
		ranges.push({ start, end });
	}
	if (ranges.length < 1) return -1;
	return options?.combine ? combineRanges(ranges) : ranges;
}

function combineRanges(ranges: ByteRange[]): ByteRange[] {
	const ordered = ranges.map((range, index) => ({ ...range, index })).sort((a, b) => a.start - b.start);
	let last = 0;
	for (let i = 1; i < ordered.length; i++) {
		const range = ordered[i];
		const current = ordered[last];
		if (range.start > current.end + 1) {
			ordered[++last] = range;
		} else if (range.end > current.end) {
			current.end = range.end;
			current.index = Math.min(current.index, range.index);
		}
	}
	ordered.length = last + 1;
	return ordered.sort((a, b) => a.index - b.index).map(({ start, end }) => ({ start, end }));
}

/* ---- Conditional requests: send's and fresh's rules. ---- */

function parseHttpDate(value: string | undefined): number {
	const time = value && Date.parse(value);
	return typeof time === 'number' ? time : NaN;
}

/* send's list reader (skips empty entries). */
function tokenList(value: string): string[] {
	const list: string[] = [];
	let start = 0;
	let end = 0;
	for (let i = 0; i < value.length; i++) {
		switch (value.charCodeAt(i)) {
			case 0x20:
				if (start === end) start = end = i + 1;
				break;
			case 0x2c:
				if (start !== end) list.push(value.substring(start, end));
				start = end = i + 1;
				break;
			default:
				end = i + 1;
		}
	}
	if (start !== end) list.push(value.substring(start, end));
	return list;
}

/* fresh's list reader (keeps empty entries). */
function freshTokenList(value: string): string[] {
	const list: string[] = [];
	let start = 0;
	let end = 0;
	for (let i = 0; i < value.length; i++) {
		switch (value.charCodeAt(i)) {
			case 0x20:
				if (start === end) start = end = i + 1;
				break;
			case 0x2c:
				list.push(value.substring(start, end));
				start = end = i + 1;
				break;
			default:
				end = i + 1;
		}
	}
	list.push(value.substring(start, end));
	return list;
}

function sameTag(match: string, etag: string): boolean {
	return match === etag || match === `W/${etag}` || `W/${match}` === etag;
}

type HeaderReader = (name: string) => string | undefined;

function preconditionFailed(header: HeaderReader, etag: string, lastModified: string): boolean {
	const match = header('if-match');
	if (match) return match !== '*' && tokenList(match).every((tag) => !sameTag(tag, etag));
	const unmodifiedSince = parseHttpDate(header('if-unmodified-since'));
	if (!isNaN(unmodifiedSince)) {
		const modified = parseHttpDate(lastModified);
		return isNaN(modified) || modified > unmodifiedSince;
	}
	return false;
}

const NO_CACHE = /(?:^|,)\s*?no-cache\s*?(?:,|$)/;

function isFresh(header: HeaderReader, etag: string, lastModified: string): boolean {
	const modifiedSince = header('if-modified-since');
	const noneMatch = header('if-none-match');
	if (!modifiedSince && !noneMatch) return false;
	const cacheControl = header('cache-control');
	if (cacheControl && NO_CACHE.test(cacheControl)) return false;
	if (noneMatch && noneMatch !== '*') {
		if (!freshTokenList(noneMatch).some((tag) => sameTag(tag, etag))) return false;
	}
	if (modifiedSince && !(parseHttpDate(lastModified) <= parseHttpDate(modifiedSince))) return false;
	return true;
}

function rangeIsFresh(ifRange: string | undefined, etag: string, lastModified: string): boolean {
	if (!ifRange) return true;
	if (ifRange.includes('"')) return ifRange.includes(etag);
	return parseHttpDate(lastModified) <= parseHttpDate(ifRange);
}

/* ---- Which file a path names: Next's public-folder lookup. ---- */

function encodeURIPath(file: string): string {
	return file
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

/* Every file under `root`, keyed by its encoded path ("/badges/gift_5000%2B.svg"),
   read once like Next reads its public folder when it starts. */
function listFiles(root: string): Map<string, string> {
	const files = new Map<string, string>();
	const walk = (dir: string, prefix: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = `${prefix}/${entry.name}`;
			if (entry.isDirectory()) walk(join(dir, entry.name), path);
			else if (entry.isFile()) files.set(encodeURIPath(path), path);
		}
	};
	walk(root, '');
	return files;
}

/* The file a request path names: as sent, decoded, or encoded (Next accepts
   all three, so /badges/gift_5000+.svg and .../gift_5000%2B.svg both work). */
function findFile(files: Map<string, string>, pathname: string): string | undefined {
	let decoded = pathname;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		/* As Next: a path that doesn't decode is matched as sent. */
	}
	let encoded = pathname;
	try {
		encoded = encodeURIPath(pathname);
	} catch {
		/* Not encodable: no match that way. */
	}
	return files.get(pathname) ?? files.get(decoded) ?? files.get(encoded);
}

/* Next forwards a path with doubled slashes or a trailing slash to the tidy
   one (308) before looking for a file. */
function tidyPath(pathname: string): string {
	const merged = pathname.replace(/\/\/+/g, '/');
	return merged !== '/' && merged.endsWith('/') ? merged.slice(0, -1) : merged;
}

/* ---- Answers. ---- */

function refusal(status: 405 | 412 | 416, headers: Headers, method: string): Response {
	/* Next answers these with its error page (and the file's own content type
	   left on it); here a short plain-text note. Nobody sees either. */
	const text = { 405: 'Method Not Allowed', 412: 'Precondition Failed', 416: 'Range Not Satisfiable' }[status];
	headers.set('cache-control', ERROR_CACHE_CONTROL);
	headers.delete('etag');
	headers.set('content-type', 'text/plain; charset=utf-8');
	return new Response(method === 'HEAD' ? null : text, { status, headers });
}

function missing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG';
}

async function sendFile(request: Request, path: string): Promise<Response | null> {
	const method = request.method;
	if (method !== 'GET' && method !== 'HEAD') {
		const headers = new Headers({ allow: 'GET, HEAD', 'cache-control': ERROR_CACHE_CONTROL });
		/* Next answers OPTIONS on a file with an empty 400. */
		if (method === 'OPTIONS') return new Response(null, { status: 400, headers });
		return refusal(405, headers, method);
	}

	let stats: Stats;
	try {
		stats = await stat(path);
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
	if (!stats.isFile()) return null;

	const size = stats.size;
	const etag = `W/"${size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
	const lastModified = stats.mtime.toUTCString();
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'cache-control': 'public, max-age=0',
		'last-modified': lastModified,
		etag,
		'content-type': publicFileType(path)
	});
	const header: HeaderReader = (name) => request.headers.get(name) ?? undefined;

	if (header('if-match') || header('if-unmodified-since') || header('if-none-match') || header('if-modified-since')) {
		if (preconditionFailed(header, etag, lastModified)) return refusal(412, headers, method);
		if (isFresh(header, etag, lastModified)) {
			headers.delete('content-type');
			return new Response(null, { status: 304, headers });
		}
	}

	let status = 200;
	let start = 0;
	let length = size;
	const rangeHeader = header('range');
	if (rangeHeader !== undefined && /^ *bytes=/.test(rangeHeader)) {
		let ranges = parseRange(size, rangeHeader, { combine: true });
		if (!rangeIsFresh(header('if-range'), etag, lastModified)) ranges = -2;
		if (ranges === -1) {
			headers.set('content-range', `bytes */${size}`);
			return refusal(416, headers, method);
		}
		if (ranges !== -2 && ranges.length === 1) {
			const [range] = ranges;
			status = 206;
			headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
			start = range.start;
			length = range.end - range.start + 1;
		}
	}

	headers.set('content-length', String(length));
	if (method === 'HEAD') return new Response(null, { status, headers });
	const file = createReadStream(path, { start, end: Math.max(start, start + length - 1) });
	return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, { status, headers });
}

export type AppPublicFiles = {
	/** The answer for a public file, or null when `url` names none. */
	answer(request: Request, url: URL): Promise<Response | null>;
};

export function appPublicFiles(root: string): AppPublicFiles {
	let files: Map<string, string> | null = null;
	const index = () => (files ??= listFiles(root));
	return {
		async answer(request, url) {
			const tidy = tidyPath(url.pathname);
			if (tidy !== url.pathname) {
				if (!findFile(index(), tidy)) return null;
				const location = `${tidy}${url.search}`;
				/* Bytes, not a string, so no content type is added (Next sends none). */
				return new Response(new TextEncoder().encode(location), {
					status: 308,
					headers: { location, refresh: `0;url=${location}` }
				});
			}
			const file = findFile(index(), url.pathname);
			return file ? sendFile(request, join(root, file)) : null;
		}
	};
}

type Next = (error?: unknown) => void;

/* The same answers as Node middleware, for Vite's dev and preview servers. */
export function appPublicMiddleware(root: string) {
	const files = appPublicFiles(root);
	return (req: IncomingMessage, res: ServerResponse, next: Next) => {
		let request: Request;
		let url: URL;
		try {
			url = new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`);
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers)) {
				if (typeof value === 'string') headers.set(name, value);
				else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
			}
			request = new Request(url, { method: req.method, headers });
		} catch {
			return next();
		}
		files.answer(request, url).then(
			(response) => {
				if (!response) return next();
				res.statusCode = response.status;
				response.headers.forEach((value, name) => res.setHeader(name, value));
				if (!response.body) return void res.end();
				const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
				body.on('error', () => res.destroy());
				res.on('close', () => body.destroy());
				body.pipe(res);
			},
			(error) => next(error)
		);
	};
}
