/* The counter overlay's poll loop, through the real page.
 *
 * Everything here is about what a viewer sees when a provider misbehaves, which is
 * the ordinary case rather than the exceptional one: Kick's public endpoint rate
 * limits, the cached viewers route has its own upstreams, and a stream ending is
 * indistinguishable at the transport level from a request that failed.
 *
 * Two failure modes are worse than showing nothing. Fabricating a zero says "this
 * stream has no viewers", which is a claim the overlay cannot support from a failed
 * request and which looks, on stream, like a real measurement. Retaining a last
 * known value indefinitely says the same thing more slowly. So the policy under
 * test is: a measured value including a measured zero is shown, a failure retains
 * the previous value inside a bounded window and then admits it does not know, and
 * nothing at all renders until the first poll has settled.
 *
 * `fetch` is the seam — driven per URL, so Kick failing while the server route
 * succeeds is expressible, which is the mixed case that a single global stub would
 * hide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CounterPage from '@/pages/counter';

/* The page's own interval, restated because it is a module-private constant
   there. Only the loop's shape depends on the exact value, and the assertions
   below advance past it rather than landing on it. */
const COUNTER_POLL_INTERVAL_MS = 10_000;

/* The page's per-cycle deadline, restated for the same reason as the interval.
   The timeout tests below straddle it deliberately — just under, then just over —
   rather than landing on it, so they assert that a bound exists at roughly this
   value without depending on which side of the boundary a timer fires. */
const REQUEST_TIMEOUT_MS = 8_000;

/** What the display renders when it has presence but no measurement. */
const UNAVAILABLE = '—';

let query: Record<string, string | string[]> = {};
vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query, replace: vi.fn() }),
}));

/** Per-URL responses. A handler returning null rejects, imitating a transport error. */
type Handler = () => unknown | null;
const handlers: { match: (url: string) => boolean; handler: Handler }[] = [];
let requests: string[] = [];
/* The abort signal of every request made, in order, so a test can assert that
   changing channels abandoned the request that was already in flight rather than
   letting its result land under the new channel's name. */
let signals: (AbortSignal | null | undefined)[] = [];
/* Held requests. Null for every test that does not care: the poll loop schedules
   its successor only after settling, so a request that never resolves is the only
   way to observe what the loop does while one is outstanding. */
let gate: Promise<void> | null = null;

/** A promise plus its resolver, for holding a request open across assertions. */
function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function respond(match: (url: string) => boolean, handler: Handler) {
  handlers.unshift({ match, handler });
}

/** The shared /api/viewers route, answering for the platforms given. */
function serverViewers(body: Record<string, { live: boolean; viewers?: number }>) {
  respond((u) => u.includes('/api/viewers'), () => body);
}

/** Kick's public channel endpoint. `null` viewers means live with no count. */
function kickLive(viewers: number | null) {
  respond(
    (u) => u.includes('kick.com/api'),
    () => ({ livestream: viewers === null ? {} : { viewer_count: viewers } }),
  );
}

function kickOffline() {
  respond((u) => u.includes('kick.com/api'), () => ({ livestream: null }));
}

function kickFails() {
  respond((u) => u.includes('kick.com/api'), () => null);
}

beforeEach(() => {
  /* performance is faked alongside the timers because the displayed number is
     animated: RollingCount eases from the old value to the new one over rAF
     frames, using performance.now() for progress. With a frozen clock the easing
     factor stays 0 and the old number is displayed forever, so a test asserting
     the new one would fail for a reason that has nothing to do with polling. */
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  handlers.length = 0;
  requests = [];
  signals = [];
  gate = null;
  query = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
      requests.push(url);
      signals.push(init?.signal);
      if (init?.signal?.aborted) throw new Error('aborted');
      if (gate) {
        /* A held request has to stay abortable, not merely start abortable.
           `fetch` rejects the moment its signal aborts, whatever the network is
           doing; a stub that checked the signal once and then awaited the gate
           would stay pending through an abort and report the poll loop as hung
           when it was not. Racing the abort event is what makes a held request
           behave like a real slow one. */
        const signal = init?.signal;
        await Promise.race([
          gate,
          new Promise<never>((_, reject) => {
            if (!signal) return;
            signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
        ]);
      }
      const entry = handlers.find((h) => h.match(url));
      const body =
        entry?.handler() ?? null;

      if (body === null) {
        throw new Error('network');
      }

      if (body instanceof Response) {
        return body;
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mounts the page and lets the first poll settle. */
async function mount() {
  const result = render(<CounterPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return result;
}

/** Advances one full poll interval, then lets the count animation finish. */
async function nextPoll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS + 10); });
  /* Separate advance: the rAF chain is only scheduled once the poll's state
     update commits, so it does not exist yet during the call above. */
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

/* The rendered text, with the inline <style> excluded.
 *
 * The display emits its @font-face and keyframes as a style element, whose text
 * contains `scale(0.85)` and `opacity: 0` — so a naive textContent read makes
 * every "no zero on screen" assertion pass or fail for reasons that have nothing
 * to do with viewer counts. Only element text is considered here. */
function text(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('nothing renders before the first poll settles', () => {
  it('renders no number while the first request is outstanding', () => {
    /* A zero here would be a fabricated measurement, on screen, in OBS, for as
       long as the first request takes. */
    query = { kick: 'somechannel' };
    kickLive(1234);
    const { container } = render(<CounterPage />);
    expect(text(container)).toBe('');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing at all when no channel is configured', async () => {
    const { container } = await mount();
    expect(text(container)).toBe('');
    expect(requests).toEqual([]);
  });
});

describe('measured values, including zero', () => {
  it('shows a measured Kick count', async () => {
    query = { kick: 'somechannel' };
    kickLive(1234);
    const { container } = await mount();
    expect(text(container)).toContain('1,234');
  });

  it('shows a measured zero rather than hiding it', async () => {
    /* Zero viewers is a fact about a live stream, not an absence of data. */
    query = { kick: 'somechannel' };
    kickLive(0);
    const { container } = await mount();
    expect(text(container)).toContain('0');
  });

  it('combines all four platforms into one total', async () => {
    query = { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt', combined: 'true' };
    kickLive(1);
    serverViewers({
      twitch: { live: true, viewers: 20 },
      youtube: { live: true, viewers: 300 },
      tiktok: { live: true, viewers: 4000 },
    });
    const { container } = await mount();
    expect(text(container)).toContain('4,321');
  });

  it('lists platforms separately when combined is off', async () => {
    query = { kick: 'k', twitch: 't', combined: 'false' };
    kickLive(7);
    serverViewers({ twitch: { live: true, viewers: 11 } });
    const { container } = await mount();
    const rendered = text(container);
    expect(rendered).toContain('7');
    expect(rendered).toContain('11');
  });
  it('shows fast Twitch without waiting for slow TikTok', async () => {
    query = {
      twitch: 'fast',
      tiktok: 'slow',
      combined: 'false',
    };

    respond(
      (url) =>
        url.includes(
          '/api/viewers',
        ) &&
        url.includes(
          'twitch=fast',
        ),
      () => ({
        twitch: {
          live: true,
          viewers: 42,
        },
      }),
    );

    let releaseTikTok:
      (value: unknown) => void =
        () => {};

    const slowTikTok =
      new Promise<unknown>(
        (resolve) => {
          releaseTikTok =
            resolve;
        },
      );

    respond(
      (url) =>
        url.includes(
          '/api/viewers',
        ) &&
        url.includes(
          'tiktok=slow',
        ),
      () => slowTikTok,
    );

    const {
      container,
    } =
      render(
        <CounterPage />,
      );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        0,
      );

      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      text(container),
    ).toContain('42');

    releaseTikTok({
      tiktok: {
        live: true,
        viewers: 9,
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(
        0,
      );
    });

    expect(
      text(container),
    ).toContain('9');
  });

  it('requests only the platforms that are configured', async () => {
    query = { kick: 'somechannel' };
    kickLive(5);
    await mount();
    expect(requests.some((u) => u.includes('kick.com/api'))).toBe(true);
    expect(requests.some((u) => u.includes('/api/viewers'))).toBe(false);
  });

  it('requests the three server platforms independently', async () => {
    query = {
      twitch: 't',
      youtube: 'y',
      tiktok: 'tt',
    };

    serverViewers({
      twitch: {
        live: true,
        viewers: 1,
      },
      youtube: {
        live: true,
        viewers: 2,
      },
      tiktok: {
        live: true,
        viewers: 3,
      },
    });

    await mount();

    const viewerCalls =
      requests.filter(
        (url) =>
          url.includes(
            '/api/viewers',
          ),
      );

    expect(
      viewerCalls,
    ).toHaveLength(3);

    expect(
      viewerCalls.filter(
        (url) =>
          url.includes(
            'twitch=t',
          ),
      ),
    ).toHaveLength(1);

    expect(
      viewerCalls.filter(
        (url) =>
          url.includes(
            'youtube=y',
          ),
      ),
    ).toHaveLength(1);

    expect(
      viewerCalls.filter(
        (url) =>
          url.includes(
            'tiktok=tt',
          ),
      ),
    ).toHaveLength(1);

    for (
      const call of
      viewerCalls
    ) {
      const present =
        [
          'twitch=',
          'youtube=',
          'tiktok=',
        ].filter(
          (key) =>
            call.includes(key),
        );

      expect(
        present,
      ).toHaveLength(1);
    }
  });
  it('backs off a limited provider while a healthy provider keeps polling', async () => {
    query = {
      twitch: 'limited',
      youtube: 'healthy',
      combined: 'false',
    };

    respond(
      (url) =>
        url.includes(
          '/api/viewers',
        ) &&
        url.includes(
          'twitch=limited',
        ),
      () =>
        new Response(
          JSON.stringify({
            error:
              'Too many viewer requests.',
          }),
          {
            status: 429,
            headers: {
              'Content-Type':
                'application/json',
              'Retry-After':
                '30',
            },
          },
        ),
    );

    respond(
      (url) =>
        url.includes(
          '/api/viewers',
        ) &&
        url.includes(
          'youtube=healthy',
        ),
      () => ({
        youtube: {
          live: true,
          viewers: 77,
        },
      }),
    );

    const {
      container,
    } =
      await mount();

    expect(
      text(container),
    ).toContain('77');

    const twitchBefore =
      requests.filter(
        (url) =>
          url.includes(
            'twitch=limited',
          ),
      ).length;

    const youtubeBefore =
      requests.filter(
        (url) =>
          url.includes(
            'youtube=healthy',
          ),
      ).length;

    await nextPoll();

    const twitchAfter =
      requests.filter(
        (url) =>
          url.includes(
            'twitch=limited',
          ),
      ).length;

    const youtubeAfter =
      requests.filter(
        (url) =>
          url.includes(
            'youtube=healthy',
          ),
      ).length;

    expect(
      twitchAfter,
    ).toBe(
      twitchBefore,
    );

    expect(
      youtubeAfter,
    ).toBeGreaterThan(
      youtubeBefore,
    );

    expect(
      text(container),
    ).toContain('77');
  });
});

describe('a failed request never becomes a measurement', () => {
  it('shows no fabricated zero when the only platform fails outright', async () => {
    /* An em-dash, not a number: the overlay says it does not know rather than
       asserting a count it never measured. */
    query = { kick: 'somechannel' };
    kickFails();
    const { container } = await mount();
    expect(text(container)).toBe(UNAVAILABLE);
    expect(text(container)).not.toMatch(/\d/);
  });

  it('keeps a live platform visible while the other fails', async () => {
    /* Partial success is preserved: one provider's outage must not blank a
       working one. */
    query = { kick: 'k', twitch: 't', combined: 'false' };
    kickFails();
    serverViewers({ twitch: { live: true, viewers: 42 } });
    const { container } = await mount();
    expect(text(container)).toContain('42');
  });

  it('reports an ended stream as nothing at all, not as zero', async () => {
    /* An offline platform has no presence, so the pill disappears rather than
       showing a count or a dash. */
    query = { kick: 'somechannel' };
    kickOffline();
    const { container } = await mount();
    expect(text(container)).toBe('');
  });

  it('treats a live stream with no usable count as unknown, not as zero', async () => {
    query = { kick: 'somechannel' };
    kickLive(null);
    const { container } = await mount();
    expect(text(container)).toBe(UNAVAILABLE);
    expect(text(container)).not.toMatch(/\d/);
  });
});

describe('a last good value is retained, then given up', () => {
  it('holds the previous count through one failed cycle', async () => {
    query = { kick: 'somechannel' };
    kickLive(500);
    const { container } = await mount();
    expect(text(container)).toContain('500');

    handlers.length = 0;
    kickFails();
    await nextPoll();
    /* Still 500: a blip should not make the number vanish and reappear. */
    expect(text(container)).toContain('500');
  });

  it('replaces a retained value the moment a real answer arrives', async () => {
    query = { kick: 'somechannel' };
    kickLive(500);
    const { container } = await mount();

    handlers.length = 0;
    kickFails();
    await nextPoll();

    handlers.length = 0;
    kickLive(900);
    await nextPoll();
    expect(text(container)).toContain('900');
    expect(text(container)).not.toContain('500');
  });

  it('lets an explicit offline replace a retained count immediately', async () => {
    /* Offline is an answer, not a failure, so it does not wait out the window. */
    query = { kick: 'somechannel' };
    kickLive(500);
    const { container } = await mount();

    handlers.length = 0;
    kickOffline();
    await nextPoll();
    expect(text(container)).toBe('');
  });
});

describe('the poll loop', () => {
  it('never overlaps two polls', async () => {
    /* The next poll is scheduled only once the current one has settled, so a
       slow provider cannot stack requests. */
    query = { kick: 'somechannel' };
    kickLive(1);
    await mount();
    const afterFirst = requests.length;
    await nextPoll();
    expect(requests.length).toBe(afterFirst * 2);
  });

  it('stops polling on unmount', async () => {
    query = { kick: 'somechannel' };
    kickLive(1);
    const { unmount } = await mount();
    const before = requests.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS * 4); });
    expect(requests.length).toBe(before);
  });

  it('leaves no timer behind after unmount', async () => {
    query = { kick: 'somechannel' };
    kickLive(1);
    const { unmount } = await mount();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no Twitch pin poll, whatever is in the URL', async () => {
    /* The counter has no pins and no connection. A fragment left on the URL by
       a copy-paste must not cause an authorized request from this page. */
    query = { twitch: 'somechannel', showPinEnabled: 'true', pinPlatforms: 'twitch' };
    window.location.hash = '#twitchConnectionId=123e4567-e89b-12d3-a456-426614174000';
    serverViewers({ twitch: { live: true, viewers: 3 } });
    await mount();
    expect(requests.some((u) => u.includes('/pins'))).toBe(false);
    expect(requests.every((u) => u.includes('/api/viewers'))).toBe(true);
    window.location.hash = '';
  });

  it('polls immediately on mount rather than waiting out an interval', () => {
    /* Synchronous assertion on purpose: the request must already have been made
       by the time the effect returns, with no timer in between. An overlay that
       waits 10 seconds for its first number is blank for 10 seconds in OBS. */
    query = { kick: 'somechannel' };
    kickLive(1);
    render(<CounterPage />);
    expect(requests.length).toBe(1);
  });

  it('keeps polling well past the first result', async () => {
    query = { kick: 'somechannel' };
    kickLive(1);
    await mount();
    const afterFirst = requests.length;
    await nextPoll();
    await nextPoll();
    await nextPoll();
    expect(requests.length).toBe(afterFirst * 4);
  });

  it('waits for the outstanding request to settle before timing the next one', async () => {
    /* The interval is measured from settle, not from send: while a request is
       outstanding, elapsed time alone produces no second request.
       "Outstanding" is now bounded. A held request used to block the loop for as
       long as the tab was open, and this assertion was written against that — it
       advanced thirty seconds and required the count to stay at one. The cycle
       deadline ends that, so the window checked here is one shorter than a
       deadline. What it still pins down is the part that matters and that the
       timeout does not change: the interval never starts while a request is in
       flight, so two polls cannot overlap. The deadline's own consequences are
       asserted in "the request timeout" below. */
    query = { kick: 'somechannel' };
    kickLive(1);
    const held = deferred();
    gate = held.promise;

    render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(requests.length).toBe(1);

    /* Past the interval several times over, still inside the first deadline. */
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(COUNTER_POLL_INTERVAL_MS / 2);
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 100); });
    expect(requests.length).toBe(1);

    gate = null;
    await act(async () => { held.release(); await vi.advanceTimersByTimeAsync(0); });
    expect(requests.length).toBe(1);
  });

  it('waits the full interval after settling, then polls again', async () => {
    query = { kick: 'somechannel' };
    kickLive(1);
    await mount();
    expect(requests.length).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS - 1); });
    expect(requests.length).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(requests.length).toBe(2);
  });

  it('aborts the request in flight when the channel changes', async () => {
    query = { kick: 'first' };
    kickLive(1);
    const held = deferred();
    gate = held.promise;

    const { rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const firstSignal = signals[0];
    expect(firstSignal?.aborted).toBe(false);

    gate = null;
    query = { kick: 'second' };
    await act(async () => { rerender(<CounterPage />); await vi.advanceTimersByTimeAsync(0); });

    expect(firstSignal?.aborted).toBe(true);
    held.release();
  });

  it('polls the new channel immediately on a channel change', async () => {
    query = { kick: 'first' };
    kickLive(1);
    const { rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = requests.length;

    query = { kick: 'second' };
    rerender(<CounterPage />);
    expect(requests.length).toBe(before + 1);
    expect(requests[requests.length - 1]).toContain('second');
  });

  it('does not restart polling for an appearance-only change', async () => {
    /* Colour, size and layout are not the loop's business. Restarting on them
       would make a settings drag issue a request per frame. */
    query = { kick: 'somechannel', fontSize: '40' };
    kickLive(1);
    const { rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = requests.length;

    query = { kick: 'somechannel', fontSize: '41', color: 'ff0000', combined: 'true' };
    rerender(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(requests.length).toBe(before);
  });

  it('aborts the request in flight on unmount', async () => {
    query = { kick: 'somechannel' };
    kickLive(1);
    const held = deferred();
    gate = held.promise;

    const { unmount } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(signals[0]?.aborted).toBe(false);

    unmount();
    expect(signals[0]?.aborted).toBe(true);
    held.release();
  });

  it('opens no websocket and no event source', async () => {
    /* The counter is a polling overlay. A socket here would be chat machinery
       leaking into a tool that does not need it. */
    const ws = vi.fn();
    const es = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    vi.stubGlobal('EventSource', es);
    query = { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt' };
    kickLive(1);
    serverViewers({ twitch: { live: true, viewers: 1 } });
    await mount();
    await nextPoll();
    expect(ws).not.toHaveBeenCalled();
    expect(es).not.toHaveBeenCalled();
  });
});

describe('a channel change discards the old channel’s numbers', () => {
  it('shows nothing at all until the new channel has its own measurement', async () => {
    /* The failure this prevents: 500 viewers measured for `first` staying on
       screen after the overlay is pointed at `second`, which is a number
       attributed to a channel it was never measured from. */
    query = { kick: 'first' };
    kickLive(500);
    const { container, rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text(container)).toContain('500');

    const held = deferred();
    gate = held.promise;
    query = { kick: 'second' };
    rerender(<CounterPage />);

    expect(text(container)).toBe('');
    expect(container.querySelector('svg')).toBeNull();
    held.release();
  });

  it('does not carry a stale offline state into the new channel', async () => {
    query = { kick: 'first' };
    kickOffline();
    const { container, rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const held = deferred();
    gate = held.promise;
    query = { kick: 'second' };
    rerender(<CounterPage />);
    expect(text(container)).toBe('');
    held.release();
  });

  it('does not blank the display for an appearance-only change', async () => {
    /* The reset is keyed on the channels, not on the query. Restyling a live
       overlay must not flash it empty. */
    query = { kick: 'somechannel', fontSize: '40' };
    kickLive(750);
    const { container, rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text(container)).toContain('750');

    query = { kick: 'somechannel', fontSize: '41' };
    rerender(<CounterPage />);
    expect(text(container)).toContain('750');
  });

  it('renders the new channel’s number once it arrives', async () => {
    query = { kick: 'first' };
    kickLive(500);
    const { container, rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    handlers.length = 0;
    kickLive(42);
    query = { kick: 'second' };
    await act(async () => { rerender(<CounterPage />); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const rendered = text(container);
    expect(rendered).toContain('42');
    expect(rendered).not.toContain('500');
  });
});

/* The hang. A provider that accepts a connection and then says nothing left
   `Promise.all` pending forever, and the commit and the first render both sit
   after that await — so the overlay stayed blank for as long as the tab was open,
   in OBS as much as in the generator's preview. The page declared an 8-second
   deadline for exactly this and never applied it. */
describe('the request timeout', () => {
  it('aborts a request that outlives the timeout', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 100); });
    expect(signals.some((s) => s?.aborted)).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(signals.some((s) => s?.aborted)).toBe(true);

    gate = null;
    held.release();
  });

  it('commits an unavailable value rather than waiting forever', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    const { container } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); });
    expect(text(container)).toBe(UNAVAILABLE);

    gate = null;
    held.release();
  });

  it('does not time out a request that answers promptly', async () => {
    query = { kick: 'somechannel' };
    kickLive(4321);
    const { container } = await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text(container)).toBe('4,321');

    /* Well past the deadline, with nothing outstanding: the settled cycle's
       timer must not fire and turn a good value into a dash. */
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 100); });
    expect(text(container)).toBe('4,321');
  });

  it('keeps the ten-second cadence measured from the timed-out settlement', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); });
    const afterFirst = requests.length;

    /* Not sooner. The interval is measured from settlement, and timing out is a
       settlement — so the next request is one interval after the deadline, not
       one interval after the request began. */
    await act(async () => { await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS - 100); });
    expect(requests.length).toBe(afterFirst);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(requests.length).toBeGreaterThan(afterFirst);

    gate = null;
    held.release();
  });

  it('never runs two polls at once while a request is held open', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    render(<CounterPage />);
    /* Three deadlines' worth. Each cycle must wait for the previous one to time
       out and then for the interval, so the count rises slowly and in step
       rather than one request per deadline arriving on top of the last. */
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); });
    expect(requests.length).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS + 10); });
    expect(requests.length).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); });
    expect(requests.length).toBe(2);

    gate = null;
    held.release();
  });

  it('abandons a held request immediately on a channel change, without waiting out the timeout', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    const { rerender } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(signals[0]?.aborted).toBe(false);

    query = { kick: 'anotherchannel' };
    rerender(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    /* Long before the deadline. */
    expect(signals[0]?.aborted).toBe(true);

    gate = null;
    held.release();
  });

  it('leaves no timer behind on unmount', async () => {
    query = { kick: 'somechannel' };
    const held = deferred();
    gate = held.promise;
    kickLive(1);

    const { unmount } = render(<CounterPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    unmount();

    /* Both the deadline and the interval are cleared, so nothing is left to run.
       A leaked deadline would still be counted here even though its abort would
       be harmless — the timer itself is the leak. */
    expect(vi.getTimerCount()).toBe(0);

    gate = null;
    held.release();
  });
});
