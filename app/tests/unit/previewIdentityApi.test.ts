import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/twitch/preview-identity';
import { parsePreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { __resetCommunityBadgeCache } from '@/lib/communityBadges';
import {
  PREVIEW_IDENTITY_PROVIDER_MAX_BYTES,
  PREVIEW_IDENTITY_PROVIDER_TIMEOUT_MS,
} from '@/lib/previewIdentityProviders';
import {
  fixedProviderResourceStatsForTests,
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(query: Record<string, string | string[]> = {}, method = 'GET') {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, body, headers }));
}

const twitchBody = {
  data: {
    badges: [
      { setID: 'subscriber', version: '1', imageURL: 'https://cdn.example/global-sub.png' },
      { setID: 'moderator', version: '1', imageURL: 'https://cdn.example/mod.png' },
    ],
    user: {
      id: '42', login: 'canonical', displayName: 'CanonicalName',
      broadcastBadges: [
        { setID: 'subscriber', version: '1', imageURL: 'https://cdn.example/channel-sub.png' },
      ],
    },
  },
};

const sevenEmote = (id: string, name: string, flags = 0) => ({
  id, name, data: { flags, host: { files: [{ height: 28, width: 28 }] } },
});

function allProviderFetch(input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://gql.twitch.tv/gql') return Promise.resolve(response(twitchBody));
  if (url === 'https://api.chatterino.com/badges') return Promise.resolve(response({
    badges: [{
      id: 'preview-owner',
      tooltip: 'Preview Owner',
      image1: 'https://cdn.example/community-preview-owner.png',
      users: ['42'],
    }],
  }));
  if (url.endsWith('/frankerfacez/emotes/global')) return Promise.resolve(response([{ id: 'fg', code: 'FFZG', images: { '4x': 'https://cdn.example/ffzg.png' } }]));
  if (url.endsWith('/frankerfacez/users/twitch/42')) return Promise.resolve(response({ emotes: [{ id: 'fr', code: 'FFZR', images: { '4x': 'https://cdn.example/ffzr.png' } }] }));
  if (url.endsWith('/v1/_room/id/42')) return Promise.resolve(response({ room: { moderator_badge: true } }));
  if (url.endsWith('/v1/badges')) return Promise.resolve(response({
    badges: [{ id: 1, urls: { '4': '//cdn.frankerfacez.com/badge/ffz-owned/4' } }],
    users: { '1': ['42'] },
  }));
  if (url.endsWith('/cached/emotes/global')) return Promise.resolve(response([{ id: 'bg', code: 'BTTVG' }]));
  if (url.endsWith('/cached/users/twitch/42')) return Promise.resolve(response({ channelEmotes: [{ id: 'bc', code: 'BTTVC' }], sharedEmotes: [{ id: 'bs', code: 'BTTVS' }] }));
  if (url.endsWith('/cached/badges/twitch')) return Promise.resolve(response([{
    providerId: '42',
    badge: { description: 'BTTV Developer', svg: 'https://cdn.betterttv.net/assets/icons/badge-dev.svg' },
  }]));
  if (url === 'https://7tv.io/v3/emote-sets/global') return Promise.resolve(response({ emotes: [sevenEmote('sg', 'SevenGlobal')] }));
  if (url === 'https://7tv.io/v3/users/twitch/42') return Promise.resolve(response({ emote_set: { emotes: [sevenEmote('sc', 'SevenChannel'), sevenEmote('sz', 'SevenZero', 256)] }, user: { personal_emotes: [sevenEmote('sp', 'SevenPersonal')] } }));
  if (url === 'https://7tv.io/v3/gql') return Promise.resolve(response({ data: { userByConnection: { style: { paint: { id: 'paint', function: 'LINEAR_GRADIENT', angle: 90, repeat: false, stops: [{ at: 0, color: 1 }], shadows: [] }, badge: { id: 'badge', host: { url: '//cdn.7tv.app/badge/badge' } } } } } }));
  throw new Error(`unexpected request ${url}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

beforeEach(() => {
  __resetCommunityBadgeCache();
  resetFixedProviderResourcesForTests();
});
afterEach(() => {
  __resetCommunityBadgeCache();
  resetFixedProviderResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Twitch Preview Identity API', () => {
  it('rejects methods and invalid input before an upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke({}, 'POST')).statusCode).toBe(405);
    expect((await invoke({ login: 'bad/login' })).statusCode).toBe(400);
    expect((await invoke({ login: 'x'.repeat(26) })).statusCode).toBe(400);
    expect((await invoke({ login: 'valid', providers: 'Unknown' })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves canonical identity and independent provider resources', async () => {
    const fetchMock = vi.fn(allProviderFetch);
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke({ login: '@Canonical' });
    expect(result.statusCode).toBe(200);
    const parsed = parsePreviewIdentityResponse(result.body)!;
    expect(parsed.identity).toEqual({ userId: '42', login: 'canonical', displayName: 'CanonicalName' });
    expect(parsed.providers.Twitch?.resources).toMatchObject({
      globalBadges: { 'subscriber/1': 'https://cdn.example/global-sub.png' },
      channelBadges: { 'subscriber/1': 'https://cdn.example/channel-sub.png' },
    });
    expect(
      parsed.providers.Twitch?.resources.globalBadges['community:chatterino:preview-owner/1'],
    ).toBe('https://cdn.example/community-preview-owner.png');
    expect(parsed.providers.FFZ?.resources.badgeOverrides['moderator/1']).toContain('/room-badge/mod/id/42/');
    expect(parsed.providers.BTTV?.resources.sharedEmotes[0].scope).toBe('shared');
    expect(parsed.providers.BTTV?.resources.ownedBadges?.[0]?.image).toContain('cdn.betterttv.net');
    expect(parsed.providers.FFZ?.resources.ownedBadges?.[0]?.image).toContain('cdn.frankerfacez.com');
    expect(parsed.providers['7TV']?.resources.personalEmotes[0].scope).toBe('personal');
    expect(parsed.providers['7TV']?.resources.channelEmotes.find((item) => item.name === 'SevenZero')?.zeroWidth).toBe(true);
    expect(parsed.providers['7TV']?.resources.paint?.id).toBe('paint');
    expect(parsed.providers['7TV']?.resources.badge?.id).toBe('badge');
  });

  it('returns 404 for an unknown Twitch login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { badges: [], user: null } })));
    const result = await invoke({ login: 'missing' });
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ error: 'Twitch user not found.' });
  });

  it('preserves successful providers when another provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('betterttv.net/3/cached/emotes/global')) return Promise.resolve(response({}, 503));
      return allProviderFetch(input);
    }));
    const result = await invoke({ login: 'canonical' });
    const parsed = parsePreviewIdentityResponse(result.body)!;
    expect(parsed.providers.Twitch?.status).toBe('loaded');
    expect(parsed.providers.FFZ?.status).toBe('loaded');
    expect(parsed.providers.BTTV?.status).toBe('failed');
    expect(parsed.providers['7TV']?.status).toBe('loaded');
  });

  it('retry allowlists re-resolve identity and call only requested providers', async () => {
    const fetchMock = vi.fn(allProviderFetch);
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke({ login: 'canonical', providers: 'BTTV,7TV' });
    expect(result.statusCode).toBe(200);
    const parsed = parsePreviewIdentityResponse(result.body)!;
    expect(Object.keys(parsed.providers).sort()).toEqual(['7TV', 'BTTV']);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain('https://gql.twitch.tv/gql');
    expect(urls.some((url) => url.includes('frankerfacez'))).toBe(false);
    expect(urls.some((url) => url.includes('api.chatterino.com'))).toBe(false);
    expect(urls.some((url) => url.includes('cached/emotes/global'))).toBe(true);
    expect(urls.some((url) => url.includes('7tv.io'))).toBe(true);
  });

  it('returns one opaque identity error for malformed Twitch data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { badges: 'bad', user: {} } })));
    const result = await invoke({ login: 'canonical' });
    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual({ error: 'Unable to load Twitch preview identity.' });
  });

  it('uses fixed provider URLs with automatic redirects disabled', async () => {
    const fetchMock = vi.fn(allProviderFetch);
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke({ login: 'canonical', providers: 'BTTV' })).statusCode).toBe(200);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
    expect(fetchMock.mock.calls.every(([input]) => {
      const hostname = new URL(String(input)).hostname;
      return ['gql.twitch.tv', 'api.betterttv.net'].includes(hostname);
    })).toBe(true);
  });

  it('coalesces identical preview identity work', async () => {
    const pending = deferred<Response>();
    let gqlCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === 'https://gql.twitch.tv/gql' && gqlCalls++ === 0) {
        return pending.promise;
      }
      return allProviderFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = invoke({ login: 'canonical', providers: 'BTTV' });
    const second = invoke({ login: 'canonical', providers: 'BTTV' });
    await Promise.resolve();
    await Promise.resolve();
    expect(gqlCalls).toBe(1);
    pending.resolve(response(twitchBody));
    const [one, two] = await Promise.all([first, second]);
    expect(one.statusCode).toBe(200);
    expect(two.body).toEqual(one.body);
  });

  it('rejects oversized declared and streamed provider bodies', async () => {
    const declared = new Response(new ReadableStream<Uint8Array>(), {
      headers: { 'Content-Length': String(PREVIEW_IDENTITY_PROVIDER_MAX_BYTES + 1) },
    });
    let sent = false;
    const streamed = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array(PREVIEW_IDENTITY_PROVIDER_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
    }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(declared)
      .mockResolvedValueOnce(streamed));
    expect((await invoke({ login: 'one', providers: 'BTTV' })).statusCode).toBe(502);
    expect((await invoke({ login: 'two', providers: 'BTTV' })).statusCode).toBe(502);
  });

  it('aborts provider timeouts and releases weighted capacity', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    const pending = invoke({ login: 'slow', providers: 'BTTV' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(PREVIEW_IDENTITY_PROVIDER_TIMEOUT_MS);
    expect((await pending).statusCode).toBe(502);
    expect(signal?.aborted).toBe(true);
    expect(fixedProviderResourceStatsForTests().active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
