/*
 * One event stream per overlay page (browser half; the server half is
 * api/overlay/stream + lib/server/overlayStreamMux).
 *
 * The chat overlay's connectors and its refresh watcher each open their own
 * server stream. While a page has started the mux (the chat overlay does), they
 * get a stand-in with the same EventSource behaviour instead, and all of them
 * share one connection: over HTTP/1.1 a browser allows six connections per
 * site, shared by every OBS browser source, and four streams per overlay used
 * most of them up. Without the mux, or for any other URL, a real EventSource.
 *
 * The stand-in behaves as an EventSource for that URL would:
 *   - `open` when its sub-stream starts, `message`/named events as they come;
 *   - a refused sub-stream (an HTTP error) fires `error` and is closed;
 *   - one that ends, or a dropped connection, fires `error` and reconnects by
 *     itself (readyState CONNECTING), resuming from its last event id;
 *   - close() stops it.
 * Adding or removing a sub-stream reconnects the shared stream; the others
 * don't notice (no error, they resume from their last event id).
 * If the shared stream can't be opened at all (an older server without it),
 * every stand-in switches to its own EventSource for the rest of the page.
 */

export const OVERLAY_STREAM_PATH = '/api/overlay/stream';

const MUXED_PATHS = new Set([
  '/api/overlay/live',
  '/api/kick/realtime',
  '/api/youtube/stream',
  '/api/tiktok/chat',
]);

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** EventSource's readyState while it reconnects by itself (a dropped
    connection; a refused one is CLOSED). */
export const EVENT_SOURCE_CONNECTING = CONNECTING;

/** Gather subscriptions made together (a page starting) into one connection. */
export const OVERLAY_STREAM_GATHER_MS = 50;
export const OVERLAY_STREAM_RETRY_START_MS = 1_000;
export const OVERLAY_STREAM_RETRY_MAX_MS = 30_000;

type Listener = (event: MessageEvent) => void;

/** The part of EventSource the overlay's code uses. */
export type OverlayEventSource = {
  readonly readyState: number;
  readonly url: string;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  /** True while a dropped connection is brought back by the page's shared
      stream, which waits longer after each failed try (1 s up to 30 s). */
  readonly sharedReconnect?: boolean;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  close(): void;
};

type NativeFactory = (url: string) => EventSource;

function pathOf(url: string): string {
  const question = url.indexOf('?');
  return question < 0 ? url : url.slice(0, question);
}

function messageEvent(type: string, data: string, lastEventId: string): MessageEvent {
  return new MessageEvent(type, { data, lastEventId });
}

class MuxedSource implements OverlayEventSource {
  readyState = CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  lastEventId = '';
  /** Asked for on the current connection, and not refused or ended there. */
  live = false;
  /** Waiting out its reconnect delay after its sub-stream ended. */
  waiting = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  private native: EventSource | null = null;

  get sharedReconnect(): boolean {
    return this.native === null;
  }

  constructor(
    private readonly mux: OverlayStreamMux,
    readonly key: string,
    readonly url: string,
  ) {}

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
      this.native?.addEventListener(type, (event) => this.fire(type, event as MessageEvent));
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    const live = this.live;
    this.readyState = CLOSED;
    this.live = false;
    this.native?.close();
    this.native = null;
    this.mux.remove(this, live);
  }

  /* From the mux. */
  opened(): void {
    if (this.readyState === CLOSED) return;
    const was = this.readyState;
    this.readyState = OPEN;
    /* A planned reconnect of the shared stream is invisible: no second open. */
    if (was !== OPEN) this.fire('open', new Event('open'));
  }

  received(type: string, id: string, data: string): void {
    if (this.readyState === CLOSED) return;
    if (id) this.lastEventId = id;
    this.fire(type, messageEvent(type, data, this.lastEventId));
  }

  /** Its request was refused: as EventSource, an error and closed. */
  refused(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.live = false;
    this.mux.remove(this, false);
    this.fire('error', new Event('error'));
  }

  /** The connection dropped or its stream ended: an error, then it reconnects. */
  interrupted(): void {
    if (this.readyState === CLOSED) return;
    this.live = false;
    this.readyState = CONNECTING;
    this.fire('error', new Event('error'));
  }

  /** Switch to a connection of its own (the shared stream isn't available). */
  goNative(factory: NativeFactory): void {
    if (this.readyState === CLOSED || this.native) return;
    const native = factory(this.url);
    this.native = native;
    native.onopen = (event) => {
      this.readyState = native.readyState;
      this.fire('open', event);
    };
    native.onmessage = (event) => this.fire('message', event);
    native.onerror = (event) => {
      this.readyState = native.readyState;
      this.fire('error', event);
    };
    for (const type of this.listeners.keys()) {
      if (type === 'open' || type === 'message' || type === 'error') continue;
      native.addEventListener(type, (event) => this.fire(type, event as MessageEvent));
    }
  }

  private fire(type: string, event: Event): void {
    if (this.readyState === CLOSED && type !== 'error') return;
    try {
      if (type === 'open') this.onopen?.(event);
      else if (type === 'message') this.onmessage?.(event as MessageEvent);
      else if (type === 'error') this.onerror?.(event);
    } catch { /* a handler's own error stays its own */ }
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        listener(event as MessageEvent);
      } catch { /* as above */ }
    }
  }
}

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export class OverlayStreamMux {
  private readonly subs = new Map<string, MuxedSource>();
  private source: EventSource | null = null;
  /** Sub-streams on the current connection. */
  private current: MuxedSource[] = [];
  private nextKey = 0;
  private gatherTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryMs = OVERLAY_STREAM_RETRY_START_MS;
  private opened = false;
  private stopped = false;
  /** The shared stream isn't available: every source uses its own. */
  fallback = false;

  constructor(
    private readonly factory: NativeFactory,
    private readonly timers: Timers,
  ) {}

  open(url: string): OverlayEventSource {
    const sub = new MuxedSource(this, (this.nextKey++).toString(36), url);
    if (this.fallback || this.stopped) {
      sub.goNative(this.factory);
      return sub;
    }
    this.subs.set(sub.key, sub);
    this.gather();
    return sub;
  }

  /**
   * A stream left. Only one the server is still sending needs a reconnect to
   * stop it; one that was refused or has ended is already gone there.
   */
  remove(sub: MuxedSource, stillSending: boolean): void {
    if (!this.subs.delete(sub.key)) return;
    const onConnection = this.current.includes(sub);
    this.current = this.current.filter((other) => other !== sub);
    if (onConnection && stillSending) this.gather();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.detach();
    for (const sub of [...this.subs.values()]) sub.close();
    this.subs.clear();
  }

  /** Reconnect soon with the current set (several changes become one). */
  private gather(delay = OVERLAY_STREAM_GATHER_MS): void {
    if (this.stopped || this.fallback) return;
    if (this.gatherTimer !== null) this.timers.clearTimeout(this.gatherTimer);
    this.gatherTimer = this.timers.setTimeout(() => {
      this.gatherTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.gatherTimer !== null) this.timers.clearTimeout(this.gatherTimer);
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.gatherTimer = null;
    this.retryTimer = null;
  }

  private detach(): void {
    const source = this.source;
    this.source = null;
    this.current = [];
    if (!source) return;
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
  }

  private connect(): void {
    if (this.stopped || this.fallback) return;
    if (this.retryTimer !== null) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.detach();
    const wanted = [...this.subs.values()].filter((sub) => sub.readyState !== CLOSED && !sub.waiting);
    if (wanted.length === 0) return;
    for (const sub of wanted) sub.live = true;
    const query = wanted
      .map((sub) => `s=${encodeURIComponent(`${sub.key}|${/^\d{1,20}$/.test(sub.lastEventId) ? sub.lastEventId : ''}|${sub.url}`)}`)
      .join('&');
    const source = this.factory(`${OVERLAY_STREAM_PATH}?${query}`);
    this.source = source;
    this.current = wanted;
    source.onopen = () => {
      if (this.source !== source) return;
      this.opened = true;
      this.retryMs = OVERLAY_STREAM_RETRY_START_MS;
    };
    source.onmessage = (event) => {
      if (this.source === source) this.dispatch(String(event.data));
    };
    source.onerror = () => {
      if (this.source !== source) return;
      this.failed();
    };
  }

  private failed(): void {
    const affected = this.current;
    this.detach();
    if (!this.opened) {
      /* Never got through: an older server, or this one refusing it. Each
         source uses its own connection from now on, as before. */
      this.fallback = true;
      this.clearTimers();
      for (const sub of [...this.subs.values()]) sub.goNative(this.factory);
      this.subs.clear();
      return;
    }
    for (const sub of affected) sub.interrupted();
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, OVERLAY_STREAM_RETRY_MAX_MS);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private dispatch(data: string): void {
    const first = data.indexOf('\t');
    const second = first < 0 ? -1 : data.indexOf('\t', first + 1);
    const third = second < 0 ? -1 : data.indexOf('\t', second + 1);
    if (third < 0) return;
    const key = data.slice(0, first);
    const type = data.slice(first + 1, second);
    const id = data.slice(second + 1, third);
    const body = data.slice(third + 1);

    if (key === '*') {
      if (type === '.move') {
        /* The server copy is handing over: reconnect (to the other copy) at once. */
        const wait = Number(body);
        this.detach();
        this.gather(Number.isFinite(wait) && wait >= 0 ? wait : OVERLAY_STREAM_GATHER_MS);
      }
      return;
    }
    const sub = this.subs.get(key);
    if (!sub || !this.current.includes(sub)) return;
    if (type === '.open') sub.opened();
    else if (type === '.error') sub.refused();
    else if (type === '.end') {
      const wait = Number(body);
      sub.interrupted();
      if (sub.readyState === CLOSED) return;
      /* As EventSource does after its stream ends: reconnect after the delay. */
      sub.waiting = true;
      this.timers.setTimeout(() => {
        sub.waiting = false;
        if (sub.readyState !== CLOSED && this.subs.get(sub.key) === sub) this.gather();
      }, Number.isFinite(wait) && wait >= 0 ? wait : 3_000);
    } else if (!type.startsWith('.')) sub.received(type, id, body);
  }
}

let mux: OverlayStreamMux | null = null;

/**
 * Share one server connection between this page's overlay streams until the
 * returned function is called. The chat overlay calls this when it starts.
 * Does nothing where there is no EventSource (and no factory is given).
 */
export function startOverlayStreamMux(
  factory?: NativeFactory,
  timers: Timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): () => void {
  if (!factory && typeof EventSource !== 'function') return () => {};
  mux?.stop();
  const own = new OverlayStreamMux(factory ?? ((url) => new EventSource(url)), timers);
  mux = own;
  return () => {
    own.stop();
    if (mux === own) mux = null;
  };
}

/** An EventSource for one of the overlay's server streams (see above). */
export function openOverlayEventSource(url: string): OverlayEventSource {
  if (mux && MUXED_PATHS.has(pathOf(url))) return mux.open(url);
  return new EventSource(url) as unknown as OverlayEventSource;
}
