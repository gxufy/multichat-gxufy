/*
 * The public files (web/public): status, caching and range headers, content
 * type and bytes for every request below, and for every real file. The
 * snapshots are what the Next.js app's file server (`send`, through
 * next/dist/server/serve-static) answered; this app was checked against it,
 * request for request, before it was retired.
 *
 * What Next's router added around `send` (405 for other methods, its error
 * pages, the tidy-path forward) was measured on `next start` and is checked
 * here as values.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPublicDir } from '@/lib/server/appPublicDir';
import { PUBLIC_FILE_TYPES, appPublicFiles, appPublicMiddleware, parseRange, publicFileType } from './appPublic.ts';

type Server = { origin: string; port: number; close: () => Promise<void> };
type Answer = { status: number; headers: Record<string, string>; sha256: string; bytes: Buffer };

function listen(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({ origin: `http://127.0.0.1:${port}`, port, close: () => new Promise((done) => server.close(() => done())) });
		});
	});
}

/* This app's answer, through SvelteKit's own request and response code. */
function webServer(root: string): Promise<Server> {
	const files = appPublicFiles(root);
	return listen(async (req, res) => {
		const request = getRequest({ request: req, response: res, base: 'http://localhost' });
		const answer = await files.answer(request, new URL(request.url));
		await setResponse(res, answer ?? new Response('page', { status: 404 }));
	});
}

const IGNORED = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);

function call(server: Server, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: '127.0.0.1', port: server.port, method, path, headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const bytes = Buffer.concat(chunks);
				const out: Record<string, string> = {};
				for (const [key, value] of Object.entries(res.headers)) {
					if (!IGNORED.has(key) && value !== undefined) out[key] = Array.isArray(value) ? value.join(', ') : value;
				}
				resolve({ status: res.statusCode ?? 0, headers: out, sha256: createHash('sha256').update(bytes).digest('hex'), bytes });
			});
		});
		req.on('error', reject);
		req.end();
	});
}

/* What is held, per kind of answer. */
function comparable(answer: Answer) {
	const pick = (names: string[]) => Object.fromEntries(names.filter((name) => name in answer.headers).map((name) => [name, answer.headers[name]]));
	if (answer.status === 412 || answer.status === 416) {
		return { status: answer.status, headers: pick(['accept-ranges', 'last-modified', 'content-range']) };
	}
	return {
		status: answer.status,
		headers: pick(['accept-ranges', 'cache-control', 'last-modified', 'etag', 'content-type', 'content-length', 'content-range']),
		sha256: answer.sha256
	};
}

describe('parseRange (range-parser, as send uses it)', () => {
	it('reads single, open, suffix and listed ranges', () => {
		expect(parseRange(100, 'bytes=0-1')).toEqual([{ start: 0, end: 1 }]);
		expect(parseRange(100, 'bytes=40-')).toEqual([{ start: 40, end: 99 }]);
		expect(parseRange(100, 'bytes=90-500')).toEqual([{ start: 90, end: 99 }]);
		expect(parseRange(100, 'bytes=-10')).toEqual([{ start: 90, end: 99 }]);
		expect(parseRange(100, 'bytes=0-1,5-6')).toEqual([
			{ start: 0, end: 1 },
			{ start: 5, end: 6 }
		]);
	});

	it('merges overlapping and adjacent ranges when asked, keeping first-asked order', () => {
		expect(parseRange(100, 'bytes=0-4,3-9', { combine: true })).toEqual([{ start: 0, end: 9 }]);
		expect(parseRange(100, 'bytes=0-4,5-9', { combine: true })).toEqual([{ start: 0, end: 9 }]);
		expect(parseRange(100, 'bytes=50-60,0-4,2-8', { combine: true })).toEqual([
			{ start: 50, end: 60 },
			{ start: 0, end: 8 }
		]);
	});

	it('is -1 when nothing is satisfiable and -2 when it is not a range', () => {
		expect(parseRange(100, 'bytes=100-')).toBe(-1);
		expect(parseRange(100, 'bytes=9-3')).toBe(-1);
		expect(parseRange(100, 'bytes=-0')).toBe(-1);
		expect(parseRange(100, 'bytes=-500')).toBe(-1);
		expect(parseRange(100, 'bytes=')).toBe(-1);
		expect(parseRange(100, 'bytes=abc')).toBe(-1);
		expect(parseRange(0, 'bytes=0-')).toBe(-1);
		expect(parseRange(100, 'bytes')).toBe(-2);
	});
});

describe('content types', () => {
	it('are the ones Next.js gave (send and its mime list) for every kind listed', () => {
		expect(PUBLIC_FILE_TYPES).toMatchSnapshot();
		expect(publicFileType('/x/NOEXT')).toBe('application/octet-stream');
		expect(publicFileType('/x/Upper.PNG')).toBe('image/png');
	});

	it('cover every file in web/public', () => {
		const root = appPublicDir();
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
			);
		const files = walk(root);
		expect(files.length).toBeGreaterThan(100);
		for (const file of files) expect(PUBLIC_FILE_TYPES, relative(root, file)).toHaveProperty([extname(file).toLowerCase()]);
		/* Names every lookup reads the same way (no '%', no dotfiles). */
		for (const file of files) expect(relative(root, file).split(sep).join('/'), file).toMatch(/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+.-]+)*\.[a-z0-9]+$/);
	});
});

describe('a folder of test files', () => {
	let dir: string;
	let web: Server;
	const clip = Buffer.from('0123456789abcdefghij');
	const modified = new Date('2026-11-16T02:19:04.000Z');

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'flosschat-public-'));
		mkdirSync(join(dir, 'used-by'));
		mkdirSync(join(dir, 'badges'));
		writeFileSync(join(dir, 'used-by', 'clip.mp4'), clip);
		writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
		writeFileSync(join(dir, 'sitemap.xml'), '<?xml version="1.0"?><urlset/>');
		writeFileSync(join(dir, 'badges', 'gift_5000+.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
		writeFileSync(join(dir, 'empty.png'), '');
		writeFileSync(join(dir, 'font.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]));
		writeFileSync(join(dir, 'noext'), 'plain');
		for (const file of ['used-by/clip.mp4', 'robots.txt', 'sitemap.xml', 'badges/gift_5000+.svg', 'empty.png', 'font.woff2', 'noext']) {
			utimesSync(join(dir, file), modified, modified);
		}
		web = await webServer(dir);
	});

	afterAll(async () => {
		await web.close();
		rmSync(dir, { recursive: true, force: true });
	});

	const lastModified = modified.toUTCString();
	const etagOf = (size: number) => `W/"${size.toString(16)}-${modified.getTime().toString(16)}"`;
	const clipTag = etagOf(clip.length);

	const cases: Array<[string, Record<string, string>]> = [
		['plain', {}],
		['if-none-match: same tag', { 'if-none-match': clipTag }],
		['if-none-match: same tag, not weak', { 'if-none-match': clipTag.slice(2) }],
		['if-none-match: in a list', { 'if-none-match': `"other", ${clipTag}` }],
		['if-none-match: list with an empty entry', { 'if-none-match': `"other",,${clipTag}` }],
		['if-none-match: any', { 'if-none-match': '*' }],
		['if-none-match: another tag', { 'if-none-match': '"nope"' }],
		['if-none-match: same tag but no-cache', { 'if-none-match': clipTag, 'cache-control': 'max-age=0, no-cache' }],
		['if-modified-since: same time', { 'if-modified-since': lastModified }],
		['if-modified-since: later', { 'if-modified-since': 'Tue, 17 Nov 2026 00:00:00 GMT' }],
		['if-modified-since: earlier', { 'if-modified-since': 'Sun, 15 Nov 2026 00:00:00 GMT' }],
		['if-modified-since: not a date', { 'if-modified-since': 'yesterday-ish' }],
		['if-none-match wins over if-modified-since', { 'if-none-match': '"nope"', 'if-modified-since': lastModified }],
		['both fresh', { 'if-none-match': clipTag, 'if-modified-since': lastModified }],
		['if-match: same tag', { 'if-match': clipTag }],
		['if-match: same tag, not weak', { 'if-match': clipTag.slice(2) }],
		['if-match: any', { 'if-match': '*' }],
		['if-match: another tag', { 'if-match': '"nope"' }],
		['if-match: list', { 'if-match': `"a" , ${clipTag}` }],
		['if-unmodified-since: later', { 'if-unmodified-since': 'Tue, 17 Nov 2026 00:00:00 GMT' }],
		['if-unmodified-since: earlier', { 'if-unmodified-since': 'Sun, 15 Nov 2026 00:00:00 GMT' }],
		['if-unmodified-since: not a date', { 'if-unmodified-since': 'soon' }],
		['range: first five', { range: 'bytes=0-4' }],
		['range: open end', { range: 'bytes=15-' }],
		['range: last five', { range: 'bytes=-5' }],
		['range: last fifty (more than the file)', { range: 'bytes=-50' }],
		['range: past the end', { range: 'bytes=999-' }],
		['range: end past the end', { range: 'bytes=10-999' }],
		['range: backwards', { range: 'bytes=9-3' }],
		['range: zero suffix', { range: 'bytes=-0' }],
		['range: two apart', { range: 'bytes=0-4,10-12' }],
		['range: two overlapping', { range: 'bytes=0-4,3-9' }],
		['range: with spaces', { range: 'bytes=0-1, 2-4' }],
		['range: leading space', { range: ' bytes=0-1' }],
		['range: not numbers', { range: 'bytes=abc' }],
		['range: empty', { range: 'bytes=' }],
		['range: another unit', { range: 'items=0-1' }],
		['range: no equals sign', { range: 'bytes' }],
		['range + if-range: same tag', { range: 'bytes=0-4', 'if-range': clipTag }],
		['range + if-range: another tag', { range: 'bytes=0-4', 'if-range': '"nope"' }],
		['range + if-range: same tag, not weak', { range: 'bytes=0-4', 'if-range': clipTag.slice(2) }],
		['range + if-range: same time', { range: 'bytes=0-4', 'if-range': lastModified }],
		['range + if-range: earlier time', { range: 'bytes=0-4', 'if-range': 'Sun, 15 Nov 2026 00:00:00 GMT' }],
		['range + fresh tag', { range: 'bytes=0-4', 'if-none-match': clipTag }]
	];

	for (const method of ['GET', 'HEAD']) {
		for (const [name, headers] of cases) {
			it(`${method} the clip, ${name}`, async () => {
				expect(comparable(await call(web, '/used-by/clip.mp4', headers, method))).toMatchSnapshot();
			});
		}
	}

	for (const path of ['/robots.txt', '/sitemap.xml', '/badges/gift_5000%2B.svg', '/empty.png', '/font.woff2', '/noext']) {
		for (const range of [undefined, 'bytes=0-1', 'bytes=0-']) {
			it(`GET ${path}${range ? ` (${range})` : ''}`, async () => {
				const headers: Record<string, string> = range ? { range } : {};
				expect(comparable(await call(web, path, headers))).toMatchSnapshot();
			});
		}
	}

	it('sends the clip byte for byte, and the part a seeking video asks for', async () => {
		const whole = await call(web, '/used-by/clip.mp4');
		expect(whole.status).toBe(200);
		expect(whole.headers['cache-control']).toBe('public, max-age=0');
		expect(whole.headers.etag).toBe(clipTag);
		expect(whole.headers['last-modified']).toBe(lastModified);
		expect(whole.bytes.equals(clip)).toBe(true);
		const part = await call(web, '/used-by/clip.mp4', { range: 'bytes=10-14' });
		expect(part.status).toBe(206);
		expect(part.headers['content-range']).toBe('bytes 10-14/20');
		expect(part.bytes.toString()).toBe('abcde');
	});

	it('refuses other methods: 405 with Allow, and 400 for OPTIONS', async () => {
		for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
			const answer = await call(web, '/robots.txt', {}, method);
			expect(answer.status, method).toBe(405);
			expect(answer.headers.allow, method).toBe('GET, HEAD');
			expect(answer.headers['cache-control'], method).toBe('private, no-cache, no-store, max-age=0, must-revalidate');
		}
		const options = await call(web, '/robots.txt', {}, 'OPTIONS');
		expect(options.status).toBe(400);
		expect(options.headers.allow).toBe('GET, HEAD');
		expect(options.bytes.length).toBe(0);
	});

	it('refuses 412 and 416 with a short note, not the file', async () => {
		const precondition = await call(web, '/used-by/clip.mp4', { 'if-match': '"nope"' });
		expect(precondition.status).toBe(412);
		expect(precondition.headers['content-type']).toBe('text/plain; charset=utf-8');
		expect(precondition.headers['cache-control']).toBe('private, no-cache, no-store, max-age=0, must-revalidate');
		expect(precondition.headers.etag).toBeUndefined();
		expect(precondition.bytes.toString()).toBe('Precondition Failed');
		const range = await call(web, '/used-by/clip.mp4', { range: 'bytes=999-' });
		expect(range.status).toBe(416);
		expect(range.headers['content-range']).toBe('bytes */20');
		expect(range.bytes.toString()).toBe('Range Not Satisfiable');
		const head = await call(web, '/used-by/clip.mp4', { range: 'bytes=999-' }, 'HEAD');
		expect(head.status).toBe(416);
		expect(head.bytes.length).toBe(0);
	});

	it('finds a file by its path as sent, decoded or encoded, like Next (measured on next start)', async () => {
		const found = ['/badges/gift_5000+.svg', '/badges/gift_5000%2B.svg', '/robots%2Etxt', '/%72obots.txt', '/robots.txt?x=1', '/fonts/../robots.txt'];
		for (const path of found) expect((await call(web, path)).status, path).toBe(200);
		/* Next finds none of these either (it answers its 404 page). */
		const missing = ['/badges/gift_5000%2b.svg', '/ROBOTS.TXT', '/used-by', '/badges', '/nope.png', '/..%2f..%2fetc%2fpasswd', '/%E0%A4%A'];
		for (const path of missing) {
			const answer = await call(web, path);
			expect(answer.status, path).toBe(404);
			expect(answer.bytes.toString(), path).toBe('page');
		}
	});

	it('forwards a file path with a trailing or doubled slash to the tidy one, like Next', async () => {
		const trailing = await call(web, '/robots.txt/?x=1');
		expect(trailing.status).toBe(308);
		expect(trailing.headers.location).toBe('/robots.txt?x=1');
		expect(trailing.headers.refresh).toBe('0;url=/robots.txt?x=1');
		expect(trailing.headers['content-type']).toBeUndefined();
		expect(trailing.bytes.toString()).toBe('/robots.txt?x=1');
		const doubled = await call(web, '//badges//gift_5000+.svg');
		expect(doubled.status).toBe(308);
		expect(doubled.headers.location).toBe('/badges/gift_5000+.svg');
		/* Only for files: anything else is left to the pages. */
		expect((await call(web, '/nope/')).status).toBe(404);
	});

	it('keeps answering after a visitor leaves halfway through a file', async () => {
		await new Promise<void>((resolve) => {
			const req = httpRequest({ host: '127.0.0.1', port: web.port, path: '/used-by/clip.mp4' }, (res) => {
				res.once('data', () => {
					req.destroy();
					resolve();
				});
			});
			req.on('error', () => resolve());
			req.end();
		});
		expect((await call(web, '/robots.txt')).status).toBe(200);
	});

	it('gives the same answers through the dev and preview middleware', async () => {
		const middleware = appPublicMiddleware(dir);
		const dev = await listen((req, res) =>
			middleware(req, res, () => {
				res.statusCode = 404;
				res.end('next');
			})
		);
		try {
			const variants: Array<Record<string, string>> = [{}, { range: 'bytes=0-4' }, { 'if-none-match': clipTag }];
			for (const headers of variants) {
				const [fromDev, fromWeb] = await Promise.all([call(dev, '/used-by/clip.mp4', headers), call(web, '/used-by/clip.mp4', headers)]);
				expect(comparable(fromDev)).toEqual(comparable(fromWeb));
			}
			const miss = await call(dev, '/missing.mp4');
			expect(miss.status).toBe(404);
			expect(miss.bytes.toString()).toBe('next');
		} finally {
			await dev.close();
		}
	});
});

describe('every real file in web/public', () => {
	let web: Server;
	const root = appPublicDir();
	const files: string[] = [];

	beforeAll(async () => {
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) walk(path);
				else files.push(`/${relative(root, path).split(sep).join('/')}`);
			}
		};
		walk(root);
		web = await webServer(root);
	});

	afterAll(async () => {
		await web.close();
	});

	/* As send answers any file: its type, size, a weak tag of size and time, and the asked part. */
	it('answers each file whole and as a range', async () => {
		const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
		expect(files.length).toBeGreaterThan(100);
		for (const file of files) {
			const path = file.split('/').map(encodeURIComponent).join('/');
			const bytes = readFileSync(join(root, file));
			const { mtime } = statSync(join(root, file));
			expect(bytes.length, file).toBeGreaterThan(0);
			const whole = await call(web, path);
			expect(comparable(whole), file).toEqual({
				status: 200,
				headers: {
					'accept-ranges': 'bytes',
					'cache-control': 'public, max-age=0',
					'last-modified': mtime.toUTCString(),
					etag: `W/"${bytes.length.toString(16)}-${mtime.getTime().toString(16)}"`,
					'content-type': publicFileType(file),
					'content-length': String(bytes.length)
				},
				sha256: sha(bytes)
			});
			const end = Math.min(99, bytes.length - 1);
			const part = await call(web, path, { range: 'bytes=0-99' });
			expect(comparable(part), file).toEqual({
				status: 206,
				headers: {
					'accept-ranges': 'bytes',
					'cache-control': 'public, max-age=0',
					'last-modified': mtime.toUTCString(),
					etag: `W/"${bytes.length.toString(16)}-${mtime.getTime().toString(16)}"`,
					'content-type': publicFileType(file),
					'content-length': String(end + 1),
					'content-range': `bytes 0-${end}/${bytes.length}`
				},
				sha256: sha(bytes.subarray(0, end + 1))
			});
		}
	}, 120_000);
});
