/* The 7TV v3 split fetch (getSevenTVChannelEmotes in lib/kick.ts).
 *
 * 7TV's "Adapt to upcoming API change" made GET /v3/users/:platform/:id able to
 * return `emote_set: null` while `emote_set_id` stays populated. One channel
 * load is therefore up to two requests: the user lookup, and — only when the
 * lookup does not already carry the emotes inline — a follow-up GET
 * /v3/emote-sets/:id routed through the by-id cache.
 *
 * These tests drive the real kick.ts against a mocked global fetch, with the
 * real cache reset between them, because the split's whole point is the
 * interaction of the two: which request fires, which id wins, and whether the
 * follow-up dedupes. Time is faked so the cache's TTL is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSevenTVChannelEmotes } from '@/lib/kick';
import { __resetSevenTVEmoteSetCache } from '@/lib/sevenTVEmoteSetCache';

/* A 7TV ActiveEmote as the API shapes it — only the fields mapSevenTVEmote
   reads. `flags` carries the zero-width (256) and upscale (128) bits. */
const activeEmote = (id: string, name: string, flags = 0) => ({
  id,
  name,
  data: { flags, host: { files: [{ width: 28, height: 28 }] } },
});

/** A user-lookup body with an INLINE emote set — the legacy fast path. */
const userWithInlineSet = (setId: string, ...names: string[]) => ({
  id: 'platform-conn-id',
  user: { id: 'stv-user-id' },
  emote_set_id: setId,
  emote_set: { id: setId, emotes: names.map((n, i) => activeEmote(`e${i}`, n)) },
});

/** A user-lookup body with NO inline emotes but a set id — the v3 path. */
const userWithSetIdOnly = (setId: string) => ({
  id: 'platform-conn-id',
  user: { id: 'stv-user-id' },
  emote_set_id: setId,
  emote_set: null,
});

/** A by-id emote-set body for the follow-up GET /v3/emote-sets/:id. */
const emoteSetBody = (setId: string, ...names: string[]) => ({
  id: setId,
  emotes: names.map((n, i) => activeEmote(`s${i}`, n)),
});

/* A fetch stub built from a URL → response table. An unlisted URL is a 404, so
   a test only names the endpoints it expects to be hit and a stray request
   fails loudly rather than silently returning nothing. */
type Reply = { ok?: boolean; status?: number; json?: unknown };
function stubFetch(table: Record<string, Reply>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = table[url];
    if (!reply) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      json: async () => reply.json ?? {},
    } as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const USER_URL = 'https://7tv.io/v3/users/twitch/12345';
const KICK_USER_URL = 'https://7tv.io/v3/users/kick/12345';
const setUrl = (id: string) => `https://7tv.io/v3/emote-sets/${id}`;

beforeEach(() => {
  vi.useFakeTimers();
  __resetSevenTVEmoteSetCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the inline fast path', () => {
  it('uses the set carried on the lookup and issues no follow-up', async () => {
    const fetchMock = stubFetch({
      [USER_URL]: { json: userWithInlineSet('set-inline', 'kekw', 'pepega') },
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.emotes.map((e) => e.name)).toEqual(['kekw', 'pepega']);
    expect(result.setId).toBe('set-inline');
    expect(result.stvUserId).toBe('stv-user-id');
    /* One request only — the inline emotes made the follow-up unnecessary. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults the platform to kick', async () => {
    const fetchMock = stubFetch({
      [KICK_USER_URL]: { json: userWithInlineSet('set-inline', 'kekw') },
    });
    await getSevenTVChannelEmotes('12345');
    expect(fetchMock).toHaveBeenCalledWith(KICK_USER_URL);
  });
});

describe('the v3 follow-up path', () => {
  it('fetches the set by id when the lookup carries no inline emotes', async () => {
    const fetchMock = stubFetch({
      [USER_URL]: { json: userWithSetIdOnly('set-remote') },
      [setUrl('set-remote')]: { json: emoteSetBody('set-remote', 'remote1', 'remote2') },
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.emotes.map((e) => e.name)).toEqual(['remote1', 'remote2']);
    expect(result.setId).toBe('set-remote');
    /* Two requests: the lookup, then the by-id set. */
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(USER_URL);
    expect(fetchMock).toHaveBeenCalledWith(setUrl('set-remote'), undefined);
  });

  it('prefers emote_set_id over an inline set object id', async () => {
    /* v3 can populate emote_set_id while the inline emote_set (if present) is a
       stale or partial object. emote_set_id is authoritative for both the emote
       list and the SSE subscription, so it must win. Here the inline set is
       empty, forcing the follow-up, and the id used is emote_set_id. */
    const fetchMock = stubFetch({
      [USER_URL]: {
        json: {
          id: 'platform-conn-id',
          user: { id: 'stv-user-id' },
          emote_set_id: 'authoritative-id',
          emote_set: { id: 'stale-inline-id', emotes: [] },
        },
      },
      [setUrl('authoritative-id')]: { json: emoteSetBody('authoritative-id', 'right') },
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.setId).toBe('authoritative-id');
    expect(result.emotes.map((e) => e.name)).toEqual(['right']);
    expect(fetchMock).toHaveBeenCalledWith(setUrl('authoritative-id'), undefined);
  });

  it('dedupes the follow-up: two channels sharing a set fetch it once', async () => {
    /* Two connectors, same active set — the second channel's follow-up must be
       answered from the by-id cache the first one populated. */
    const fetchMock = stubFetch({
      [USER_URL]: { json: userWithSetIdOnly('shared-set') },
      [setUrl('shared-set')]: { json: emoteSetBody('shared-set', 'shared') },
    });
    const first = await getSevenTVChannelEmotes('12345', 'twitch');
    const second = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(first.emotes.map((e) => e.name)).toEqual(['shared']);
    expect(second.emotes.map((e) => e.name)).toEqual(['shared']);
    /* Three requests, not four: two user lookups (not cached here) but a single
       by-id set fetch shared through the cache. */
    const setCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === setUrl('shared-set'),
    );
    expect(setCalls).toHaveLength(1);
  });
});

describe('degenerate lookups', () => {
  it('returns empty for an unregistered user (lookup 404)', async () => {
    stubFetch({}); // every URL 404s
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result).toEqual({ emotes: [], setId: null, stvUserId: null });
  });

  it('returns empty emotes but keeps a set id when the follow-up 404s', async () => {
    /* The connection points at a set that no longer resolves. The id is still
       reported (the caller may want it for the subscription), but there are no
       emotes and the negative cache — asserted elsewhere — absorbs the miss. */
    stubFetch({
      [USER_URL]: { json: userWithSetIdOnly('deleted-set') },
      // setUrl('deleted-set') deliberately absent → 404 → 'missing'
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.emotes).toEqual([]);
    expect(result.setId).toBe('deleted-set');
  });

  it('reports no set at all when the connection has neither id nor inline set', async () => {
    stubFetch({
      [USER_URL]: { json: { id: 'conn', user: { id: 'stv-user-id' } } },
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.emotes).toEqual([]);
    expect(result.setId).toBeNull();
    expect(result.stvUserId).toBe('stv-user-id');
  });

  it('drops malformed emotes that lack a name or id', async () => {
    stubFetch({
      [USER_URL]: {
        json: {
          id: 'conn',
          user: { id: 'stv-user-id' },
          emote_set_id: 'set-mixed',
          emote_set: {
            id: 'set-mixed',
            emotes: [
              activeEmote('e0', 'good'),
              { id: 'no-name' },
              { name: 'no-id' },
              null,
            ],
          },
        },
      },
    });
    const result = await getSevenTVChannelEmotes('12345', 'twitch');
    expect(result.emotes.map((e) => e.name)).toEqual(['good']);
  });
});
