/* The process-wide 7TV emote-set cache (lib/sevenTVEmoteSetCache.ts).
 *
 * The cache's whole job is to make asking for the same set id twice cheap and
 * consistent, and to do so without ever poisoning itself on a blip. Those are
 * behavioural guarantees, not implementation details, so they are asserted
 * against the one function callers use — resolveSevenTVEmoteSet — with the
 * underlying by-id fetch mocked. The mock is the seam: it lets a test say "this
 * id 404s", "this fetch is slow", "this one fails", and then watch what the
 * cache remembers.
 *
 * Time is faked so the TTLs can be crossed deterministically. The cache reads
 * Date.now(); advancing the fake clock is what makes an entry stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmoteSetOutcome, SevenTVEmote } from '@/lib/kick';

/* The cache imports exactly one thing from ./kick — the by-id fetch — so the
   mock need only supply that. Everything the cache decides (what to remember,
   for how long, when to share a request) is downstream of this one call. */
vi.mock('@/lib/kick', () => ({
  fetchSevenTVEmoteSet: vi.fn(),
}));

import { fetchSevenTVEmoteSet } from '@/lib/kick';
import {
  EMOTE_SET_TTL_MS,
  EMOTE_SET_NEGATIVE_TTL_MS,
  resolveSevenTVEmoteSet,
  clearSevenTVEmoteSetCache,
  __resetSevenTVEmoteSetCache,
} from '@/lib/sevenTVEmoteSetCache';

const fetchMock = vi.mocked(fetchSevenTVEmoteSet);

/** A recognisable emote so an assertion names the set it came from. */
const emote = (name: string): SevenTVEmote => ({
  name,
  image: `https://cdn.7tv.app/emote/${name}/4x.webp`,
  height: 28,
  width: 28,
  zeroWidth: false,
  upscale: false,
});

const ok = (...names: string[]): EmoteSetOutcome => ({
  status: 'ok',
  emotes: names.map(emote),
});
const missing = (): EmoteSetOutcome => ({ status: 'missing' });
const error = (): EmoteSetOutcome => ({ status: 'error' });

/** A fetch that never settles until the returned resolver is called. */
function deferred(): { promise: Promise<EmoteSetOutcome>; resolve: (o: EmoteSetOutcome) => void } {
  let resolve!: (o: EmoteSetOutcome) => void;
  const promise = new Promise<EmoteSetOutcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetSevenTVEmoteSetCache();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a cold ask', () => {
  it('fetches the set once and returns its emotes', async () => {
    fetchMock.mockResolvedValue(ok('kekw', 'pepega'));
    const emotes = await resolveSevenTVEmoteSet('set-a');
    expect(emotes.map((e) => e.name)).toEqual(['kekw', 'pepega']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('set-a', undefined);
  });

  it('treats an empty 200 as authoritative, not as a failure to cache', async () => {
    /* An empty set is a real answer: the streamer has an active set with no
       emotes in it. Caching it is what keeps a refresh from re-asking. */
    fetchMock.mockResolvedValue(ok());
    expect(await resolveSevenTVEmoteSet('empty')).toEqual([]);
    expect(await resolveSevenTVEmoteSet('empty')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('a warm cache', () => {
  it('answers a second ask for the same id without a second fetch', async () => {
    fetchMock.mockResolvedValue(ok('kekw'));
    await resolveSevenTVEmoteSet('set-a');
    const second = await resolveSevenTVEmoteSet('set-a');
    expect(second.map((e) => e.name)).toEqual(['kekw']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct ids in distinct entries', async () => {
    fetchMock.mockImplementation(async (id) =>
      id === 'set-a' ? ok('a-emote') : ok('b-emote'),
    );
    expect((await resolveSevenTVEmoteSet('set-a')).map((e) => e.name)).toEqual(['a-emote']);
    expect((await resolveSevenTVEmoteSet('set-b')).map((e) => e.name)).toEqual(['b-emote']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('in-flight de-duplication', () => {
  it('collapses concurrent asks for one id into a single fetch', async () => {
    const d = deferred();
    fetchMock.mockReturnValue(d.promise);

    /* Three askers before the fetch settles — the initial load and two
       connectors that happen to share the set, say. */
    const all = Promise.all([
      resolveSevenTVEmoteSet('shared'),
      resolveSevenTVEmoteSet('shared'),
      resolveSevenTVEmoteSet('shared'),
    ]);
    d.resolve(ok('shared-emote'));
    const results = await all;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.map((e) => e.name)).toEqual(['shared-emote']);
  });

  it('releases the id once settled, so a later ask past the TTL refetches', async () => {
    fetchMock.mockResolvedValue(ok('one'));
    await resolveSevenTVEmoteSet('set-a');
    vi.advanceTimersByTime(EMOTE_SET_TTL_MS + 1);
    fetchMock.mockResolvedValue(ok('two'));
    expect((await resolveSevenTVEmoteSet('set-a')).map((e) => e.name)).toEqual(['two']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('positive TTL', () => {
  it('serves from cache right up to the TTL', async () => {
    fetchMock.mockResolvedValue(ok('kekw'));
    await resolveSevenTVEmoteSet('set-a');
    vi.advanceTimersByTime(EMOTE_SET_TTL_MS - 1);
    await resolveSevenTVEmoteSet('set-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has passed', async () => {
    fetchMock.mockResolvedValue(ok('kekw'));
    await resolveSevenTVEmoteSet('set-a');
    vi.advanceTimersByTime(EMOTE_SET_TTL_MS + 1);
    await resolveSevenTVEmoteSet('set-a');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('negative caching of a 404', () => {
  it('remembers a missing set and does not re-request within the negative TTL', async () => {
    fetchMock.mockResolvedValue(missing());
    expect(await resolveSevenTVEmoteSet('gone')).toEqual([]);
    expect(await resolveSevenTVEmoteSet('gone')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-requests a missing set after the (shorter) negative TTL', async () => {
    fetchMock.mockResolvedValue(missing());
    await resolveSevenTVEmoteSet('gone');
    vi.advanceTimersByTime(EMOTE_SET_NEGATIVE_TTL_MS + 1);
    fetchMock.mockResolvedValue(ok('reborn'));
    /* A set can be recreated; the negative entry is a courtesy, not a verdict. */
    expect((await resolveSevenTVEmoteSet('gone')).map((e) => e.name)).toEqual(['reborn']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('expires the negative entry sooner than a positive one would', () => {
    /* The relationship, pinned: a deleted set is retried in about a minute, a
       live set is trusted for about ten. Swapping these would either hammer the
       API on 404s or hide a recreated set for ten minutes. */
    expect(EMOTE_SET_NEGATIVE_TTL_MS).toBeLessThan(EMOTE_SET_TTL_MS);
  });
});

describe('a transient failure', () => {
  it('is never cached — the very next ask tries again', async () => {
    fetchMock.mockResolvedValueOnce(error());
    expect(await resolveSevenTVEmoteSet('flaky')).toEqual([]);
    fetchMock.mockResolvedValueOnce(ok('recovered'));
    expect((await resolveSevenTVEmoteSet('flaky')).map((e) => e.name)).toEqual(['recovered']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not wedge the id: a failed in-flight request is cleared', async () => {
    const d = deferred();
    fetchMock.mockReturnValueOnce(d.promise);
    const first = resolveSevenTVEmoteSet('flaky');
    d.resolve(error());
    expect(await first).toEqual([]);
    /* The in-flight map must have released the id, or this second ask would
       await the already-settled failed request forever. */
    fetchMock.mockResolvedValueOnce(ok('now-ok'));
    expect((await resolveSevenTVEmoteSet('flaky')).map((e) => e.name)).toEqual(['now-ok']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('an explicit clear (the refresh-emotes command)', () => {
  it('drops the positive entry so the next ask refetches', async () => {
    fetchMock.mockResolvedValue(ok('old'));
    await resolveSevenTVEmoteSet('set-a');
    clearSevenTVEmoteSetCache();
    fetchMock.mockResolvedValue(ok('new'));
    expect((await resolveSevenTVEmoteSet('set-a')).map((e) => e.name)).toEqual(['new']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a negative entry too, so a recreated set is picked up at once', async () => {
    fetchMock.mockResolvedValue(missing());
    await resolveSevenTVEmoteSet('gone');
    clearSevenTVEmoteSetCache();
    fetchMock.mockResolvedValue(ok('reborn'));
    expect((await resolveSevenTVEmoteSet('gone')).map((e) => e.name)).toEqual(['reborn']);
  });
});

describe('a caller abort', () => {
  it('resolves that caller to [] without cancelling a shared fetch', async () => {
    const d = deferred();
    fetchMock.mockReturnValue(d.promise);

    const controller = new AbortController();
    const aborting = resolveSevenTVEmoteSet('shared', controller.signal);
    const patient = resolveSevenTVEmoteSet('shared');

    controller.abort();
    /* The aborting caller gives up with an empty list... */
    expect(await aborting).toEqual([]);

    /* ...but the underlying fetch was shared, so the patient caller still gets
       the real answer and the cache is still populated. */
    d.resolve(ok('shared-emote'));
    expect((await patient).map((e) => e.name)).toEqual(['shared-emote']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const later = await resolveSevenTVEmoteSet('shared');
    expect(later.map((e) => e.name)).toEqual(['shared-emote']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] immediately when the signal is already aborted', async () => {
    const d = deferred();
    fetchMock.mockReturnValue(d.promise);
    const controller = new AbortController();
    controller.abort();
    expect(await resolveSevenTVEmoteSet('set-a', controller.signal)).toEqual([]);
    d.resolve(ok('late'));
  });

  it('passes the signal through to the underlying fetch on a cold ask', async () => {
    fetchMock.mockResolvedValue(ok('kekw'));
    const controller = new AbortController();
    await resolveSevenTVEmoteSet('set-a', controller.signal);
    expect(fetchMock).toHaveBeenCalledWith('set-a', controller.signal);
  });
});
