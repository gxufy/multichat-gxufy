/*
 * One event stream per overlay page, carrying all of its server streams
 * (GET /api/overlay/stream; the browser half is lib/overlayEventStream.ts).
 *
 * A chat overlay used to hold four server-sent-event connections open at once:
 * the owner's commands (/api/overlay/live), Kick (/api/kick/realtime), YouTube
 * (/api/youtube/stream) and TikTok (/api/tiktok/chat). Over HTTP/1.1 a browser
 * allows six connections per site, and OBS shares those six between all of its
 * browser sources, so a chat overlay and a counter left one connection for
 * everything else: a second overlay lost platforms and new pages stalled.
 *
 * This runs those same route handlers, unchanged, against stand-in request and
 * response objects, and writes their events into one response. Each handler
 * keeps its own checks (channel validation, admission limits, hub capacity,
 * `since` filtering, Last-Event-ID resume, deploy handover).
 *
 * Frame: every event is one SSE message whose data is
 *   <key> TAB <event> TAB <id> TAB <data>
 * <key> names the sub-stream (chosen by the browser), <event> is its event name
 * ('message' unless it named one) or a control name starting with '.', <id> its
 * event id (may be empty) and <data> its data. Controls:
 *   .open   the sub-stream started
 *   .error  it was refused; data is "<HTTP status> <Retry-After seconds or ''>"
 *   .end    it finished; data is its reconnect delay in milliseconds
 * and on key '*': .move (this server copy is handing over; data: delay in ms).
 */
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders } from 'node:http';
import type { ApiRequest, ApiResponse } from './apiTypes';

export const OVERLAY_STREAM_PATHS = [
  '/api/overlay/live',
  '/api/kick/realtime',
  '/api/youtube/stream',
  '/api/tiktok/chat',
] as const;

export type OverlayStreamPath = (typeof OVERLAY_STREAM_PATHS)[number];

/** At most this many sub-streams in one overlay stream (an overlay needs four). */
export const OVERLAY_STREAM_MAX_SUBS = 6;
/** How long the browser waits before reconnecting after a handover. */
export const OVERLAY_STREAM_MOVE_DELAY_MS = 500;
/** Keep-alive comment interval (proxies drop silent connections). */
export const OVERLAY_STREAM_KEEPALIVE_MS = 15_000;
/** Default reconnect delay of a sub-stream that ended, as EventSource uses. */
const DEFAULT_RETRY_MS = 3_000;

export type OverlayStreamSub = {
  key: string;
  /** The sub-stream's last event id the browser saw ('' if none). */
  lastEventId: string;
  path: OverlayStreamPath;
  query: URLSearchParams;
};

const KEY_RE = /^[a-z0-9]{1,8}$/;
const LAST_ID_RE = /^\d{0,20}$/;
const PATHS = new Set<string>(OVERLAY_STREAM_PATHS);

/**
 * Parse the repeated `s=<key>|<lastEventId>|<path>?<query>` parameters. Null if
 * any is malformed, names a path outside the four streams, or repeats a key.
 */
export function parseOverlayStreamSubs(value: unknown): OverlayStreamSub[] | null {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  if (raw.length === 0 || raw.length > OVERLAY_STREAM_MAX_SUBS) return null;
  const subs: OverlayStreamSub[] = [];
  const keys = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length > 2_048) return null;
    const first = entry.indexOf('|');
    const second = first < 0 ? -1 : entry.indexOf('|', first + 1);
    if (second < 0) return null;
    const key = entry.slice(0, first);
    const lastEventId = entry.slice(first + 1, second);
    const target = entry.slice(second + 1);
    if (!KEY_RE.test(key) || keys.has(key) || !LAST_ID_RE.test(lastEventId)) return null;
    const question = target.indexOf('?');
    const path = question < 0 ? target : target.slice(0, question);
    if (!PATHS.has(path)) return null;
    keys.add(key);
    subs.push({
      key,
      lastEventId,
      path: path as OverlayStreamPath,
      query: new URLSearchParams(question < 0 ? '' : target.slice(question + 1)),
    });
  }
  return subs;
}

/** One SSE message carrying a sub-stream's event. */
export function overlayStreamFrame(key: string, event: string, id: string, data: string): string {
  const lines = data.split('\n');
  let frame = `data: ${key}\t${event}\t${id}\t${lines[0]}\n`;
  for (let index = 1; index < lines.length; index += 1) frame += `data: ${lines[index]}\n`;
  return `${frame}\n`;
}

/** The query object a route handler gets for these parameters (see apiRoute). */
function routeQuery(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [name, value] of params) {
    const current = query[name];
    if (current === undefined) query[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[name] = [current, value];
  }
  return query;
}

/** How far before a YouTube or TikTok stream's last event a resume starts. */
export const OVERLAY_STREAM_RESUME_MARGIN_MS = 5_000;

/** Where a browser's resume point goes for each stream. */
export function subRequestParts(
  sub: OverlayStreamSub,
  headers: IncomingHttpHeaders,
): { query: Record<string, string | string[]>; headers: IncomingHttpHeaders } {
  const params = new URLSearchParams(sub.query);
  const own: IncomingHttpHeaders = { ...headers };
  delete own['last-event-id'];
  if (sub.lastEventId) {
    if (sub.path === '/api/kick/realtime') {
      /* The Kick hub replays only events after this sequence. */
      own['last-event-id'] = sub.lastEventId;
    } else if (sub.path === '/api/youtube/stream' || sub.path === '/api/tiktok/chat') {
      /* Their ids are event times: start from shortly before the last one
         seen, not from the overlay's start, so a reconnect doesn't replay the
         whole backlog. The margin covers a resume on the other server copy
         after a deploy (its YouTube batches carry its own receive times); the
         overlay drops what it already showed. */
      const since = Number(params.get('since'));
      const from = Number(sub.lastEventId) - OVERLAY_STREAM_RESUME_MARGIN_MS;
      if (Number.isFinite(from) && from > 0 && (!Number.isFinite(since) || from > since)) {
        params.set('since', String(from));
      }
    }
  }
  return { query: routeQuery(params), headers: own };
}

/** Stand-in for the route's request: the real request's headers and socket. */
export class SubRequest extends EventEmitter {
  readonly method = 'GET';
  readonly url: string;
  readonly query: Record<string, string | string[]>;
  readonly headers: IncomingHttpHeaders;
  readonly socket: unknown;

  constructor(parent: Pick<ApiRequest, 'headers' | 'socket'>, sub: OverlayStreamSub) {
    super();
    const parts = subRequestParts(sub, parent.headers);
    this.query = parts.query;
    this.headers = parts.headers;
    this.socket = parent.socket;
    const search = sub.query.toString();
    this.url = search ? `${sub.path}?${search}` : sub.path;
  }
}

/** Streams whose event ids are the event's own time (see subRequestParts). */
const TIMESTAMP_IDS = new Set<string>(['/api/youtube/stream', '/api/tiktok/chat']);

function timestampOf(data: string): string {
  if (!data.includes('"timestamp"')) return '';
  try {
    const value = Number((JSON.parse(data) as { timestamp?: unknown }).timestamp);
    return Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : '';
  } catch {
    return '';
  }
}

/**
 * Stand-in for the route's response. What the route writes as SSE is parsed
 * back into events and written to the overlay stream as frames; its status,
 * start and end become the .open, .error and .end controls.
 */
export class SubResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  private readonly headerValues = new Map<string, string>();
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];
  private lastId = '';
  private retryMs = DEFAULT_RETRY_MS;
  private readonly stampTimes: boolean;

  constructor(
    private readonly key: string,
    path: OverlayStreamPath,
    private readonly out: (chunk: string) => void,
  ) {
    super();
    this.stampTimes = TIMESTAMP_IDS.has(path);
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headerValues.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headerValues.get(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.headerValues.delete(name.toLowerCase());
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  writeHead(code: number, headers?: Record<string, string | number | readonly string[]>): this {
    this.statusCode = code;
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
    this.start();
    return this;
  }

  flushHeaders(): void {
    this.start();
  }

  json(_body?: unknown): this {
    return this.end();
  }

  send(_body?: unknown): this {
    return this.end();
  }

  write(chunk: unknown): boolean {
    if (this.writableEnded) return false;
    this.start();
    if (this.statusCode < 400) this.feed(String(chunk));
    return true;
  }

  end(chunk?: unknown): this {
    if (this.writableEnded) return this;
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') this.write(chunk);
    this.writableEnded = true;
    if (this.statusCode >= 400) {
      this.out(overlayStreamFrame(this.key, '.error', '', `${this.statusCode} ${this.getHeader('retry-after') ?? ''}`.trim()));
    } else {
      this.headersSent = true;
      this.out(overlayStreamFrame(this.key, '.end', '', String(this.retryMs)));
    }
    this.emit('finish');
    this.emit('close');
    return this;
  }

  /** The overlay stream closed: end quietly, as a dropped connection would. */
  abort(): void {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit('close');
  }

  private start(): void {
    if (this.headersSent) return;
    this.headersSent = true;
    if (this.statusCode < 400) this.out(overlayStreamFrame(this.key, '.open', '', ''));
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.line(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  /* The EventSource parsing rules, for the parts the routes use. */
  private line(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventName = value;
    else if (field === 'data') this.dataLines.push(value);
    else if (field === 'id') {
      if (!value.includes('\0')) this.lastId = value;
    } else if (field === 'retry') {
      if (/^\d+$/.test(value)) this.retryMs = Number(value);
    }
  }

  private dispatch(): void {
    const name = this.eventName || 'message';
    this.eventName = '';
    if (this.dataLines.length === 0) return;
    const data = this.dataLines.join('\n');
    this.dataLines = [];
    const id = this.stampTimes ? timestampOf(data) : this.lastId;
    this.out(overlayStreamFrame(this.key, name, id, data));
  }
}

export type OverlayStreamHandler = (req: ApiRequest, res: ApiResponse) => unknown;

/**
 * Start every sub-stream on its route handler. Returns a function that ends
 * them all (the overlay stream closed).
 */
export function startOverlayStreamSubs(
  parent: Pick<ApiRequest, 'headers' | 'socket'>,
  subs: readonly OverlayStreamSub[],
  handlers: Readonly<Record<OverlayStreamPath, OverlayStreamHandler>>,
  out: (chunk: string) => void,
): () => void {
  const running: Array<{ req: SubRequest; res: SubResponse }> = [];
  for (const sub of subs) {
    const req = new SubRequest(parent, sub);
    const res = new SubResponse(sub.key, sub.path, out);
    running.push({ req, res });
    const fail = () => {
      if (!res.writableEnded) res.status(500).end();
    };
    try {
      const result = handlers[sub.path](req as unknown as ApiRequest, res as unknown as ApiResponse);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(fail);
      }
    } catch {
      fail();
    }
  }
  return () => {
    for (const { req, res } of running) {
      req.emit('aborted');
      req.emit('close');
      res.abort();
    }
  };
}
