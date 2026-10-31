import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  buildPreviewIdentityCosmetics,
  buildPreviewIdentityMessages,
  mergeIdentityEmotes,
  mergePreviewIdentityBadgeMaps,
  mergePreviewIdentityRetry,
  mergeTwitchBadgeMaps,
  parsePreviewIdentityResponse,
  type PreviewIdentityResponse,
  type PreviewIdentityEmote,
} from '@/features/multichat/previewIdentity';
import { buildParsedMessage } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

const emote = (
  id: string,
  name: string,
  provider: 'FFZ' | 'BTTV' | '7TV',
  scope: PreviewIdentityEmote['scope'],
  zeroWidth = false,
): PreviewIdentityEmote => ({
  id, name, provider, scope, zeroWidth, upscale: false,
  image: `https://cdn.example/${id}.webp`, height: 28, width: 28,
});

const response = (): PreviewIdentityResponse => ({
  identity: { userId: '42', login: 'canonical', displayName: 'CanonicalName' },
  providers: {
    Twitch: {
      status: 'loaded',
      resources: {
        globalBadges: {
          'subscriber/1': 'https://cdn.example/global-sub.png',
          'moderator/1': 'https://cdn.example/mod.png',
        },
        channelBadges: { 'subscriber/1': 'https://cdn.example/channel-sub.png' },
      },
    },
    FFZ: {
      status: 'loaded',
      resources: {
        globalEmotes: [emote('ffz-global', 'FFZGlobal', 'FFZ', 'global')],
        roomEmotes: [emote('ffz-room', 'FFZRoom', 'FFZ', 'room')],
        badgeOverrides: { 'moderator/1': 'https://cdn.example/ffz-mod.png' },
        ownedBadges: [],
      },
    },
    BTTV: {
      status: 'failed',
      resources: {
        globalEmotes: [emote('bttv-global', 'BTTVGlobal', 'BTTV', 'global')],
        channelEmotes: [], sharedEmotes: [], ownedBadges: [],
      },
    },
    '7TV': {
      status: 'loaded',
      resources: {
        globalEmotes: [emote('stv-base', 'SevenBase', '7TV', 'global')],
        channelEmotes: [emote('stv-zero', 'SevenZero', '7TV', 'channel', true)],
        personalEmotes: [emote('stv-personal', 'SevenPersonal', '7TV', 'personal')],
        paint: {
          id: 'paint', func: 'LINEAR_GRADIENT', angle: 90, repeat: false,
          shadows: [], stops: [{ color: 0xff0000ff, at: 0 }, { color: 0x0000ffff, at: 1 }],
        },
        badge: { id: 'seven-badge', image: 'https://cdn.7tv.app/seven-badge.png' },
      },
    },
  },
});

describe('Preview Identity model', () => {
  it('validates a complete endpoint response from unknown', () => {
    expect(parsePreviewIdentityResponse(response())).toEqual(response());
    expect(parsePreviewIdentityResponse({ ...response(), identity: { userId: 'bad' } })).toBeNull();
    expect(parsePreviewIdentityResponse({ ...response(), providers: { Unknown: {} } })).toBeNull();
  });

  it('drops an invalid individual cosmetic without discarding the provider response', () => {
    const value = response();
    const parsed = parsePreviewIdentityResponse({
      ...value,
      providers: {
        ...value.providers,
        '7TV': {
          ...value.providers['7TV']!,
          resources: {
            ...value.providers['7TV']!.resources,
            badge: { id: 'bad-badge', image: 'https://evil.example/badge.png' },
          },
        },
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.providers['7TV']?.resources.badge).toBeNull();
    expect(parsed?.providers['7TV']?.resources.paint?.id).toBe('paint');
  });

  it('rejects structurally malformed provider data but drops malformed individual emotes', () => {
    const value = structuredClone(response()) as any;
    value.providers.FFZ.resources.globalEmotes.push({ id: '', image: 'javascript:bad' });
    expect(parsePreviewIdentityResponse(value)?.providers.FFZ?.resources.globalEmotes).toHaveLength(1);
    value.providers.FFZ.resources.roomEmotes = {};
    expect(parsePreviewIdentityResponse(value)).toBeNull();
  });

  it('applies Twitch channel precedence and provider emote precedence', () => {
    expect(mergeTwitchBadgeMaps(response().providers.Twitch!.resources)).toMatchObject({
      'subscriber/1': 'https://cdn.example/channel-sub.png',
      'moderator/1': 'https://cdn.example/mod.png',
    });
    expect(mergePreviewIdentityBadgeMaps(response().providers)).toMatchObject({
      'subscriber/1': 'https://cdn.example/channel-sub.png',
      'moderator/1': 'https://cdn.example/ffz-mod.png',
    });
    const original = response();
    const value: PreviewIdentityResponse = {
      ...original,
      providers: {
        ...original.providers,
        FFZ: {
          ...original.providers.FFZ!,
          resources: { ...original.providers.FFZ!.resources, globalEmotes: [emote('ffz', 'COLLIDE', 'FFZ', 'global')] },
        },
        '7TV': {
          ...original.providers['7TV']!,
          resources: { ...original.providers['7TV']!.resources, channelEmotes: [emote('stv', 'COLLIDE', '7TV', 'channel')] },
        },
      },
    };
    expect(mergeIdentityEmotes(value.providers).find((item) => item.name === 'COLLIDE')?.id).toBe('stv');
  });

  it('preserves successful slices when a failed provider retry is merged', () => {
    const current = response();
    const retry: PreviewIdentityResponse = {
      identity: current.identity,
      providers: {
        BTTV: { status: 'loaded', resources: { globalEmotes: [], channelEmotes: [], sharedEmotes: [] } },
      },
    };
    const merged = mergePreviewIdentityRetry(current, retry)!;
    expect(merged.providers.Twitch).toBe(current.providers.Twitch);
    expect(merged.providers.BTTV?.status).toBe('loaded');
    expect(mergePreviewIdentityRetry(current, { ...retry, identity: { ...retry.identity, userId: '99' } })).toBeNull();
  });

  it('builds deterministic demonstrations only from loaded resources', () => {
    const first = buildPreviewIdentityMessages(response());
    const second = buildPreviewIdentityMessages(response());
    expect(first).toEqual(second);
    expect(first.map((item) => item.templateId)).toEqual(expect.arrayContaining([
      'twitch-badge', 'twitch-channel-badge', 'ffz-room-badge', '7tv-cosmetics',
      '7tv-emote', 'bttv-emote', 'ffz-emote', 'zero-width',
    ]));
    expect(first.every((item) => item.senderId === '42' && item.username === 'CanonicalName')).toBe(true);
    expect(first.find((item) => item.templateId === 'zero-width')?.text).toBe('BTTVGlobal SevenZero');
  });

  it('builds entitlement cosmetics and renders badge, paint, emotes, and zero-width through production conversion', () => {
    const value = response();
    const cosmetics = buildPreviewIdentityCosmetics(value);
    expect(cosmetics.entitlements['twitch:42']).toEqual({ badge: 'seven-badge', paint: 'paint' });
    const templates = buildPreviewIdentityMessages(value);
    const zero = templates.find((item) => item.templateId === 'zero-width')!;
    const raw = { ...zero, id: 'identity-1', timestamp: 1 };
    const parsed = buildParsedMessage(
      raw,
      MultichatQuerySchema.parse({ twitch: 'channel' }),
      cosmetics,
      { enabled: false, colors: new Map() },
      1,
    );
    const { container } = render(<>{parsed.identity.badges}{parsed.message}</>);
    expect(parsed.identity.background).toContain('linear-gradient');
    expect(container.querySelector('img[alt="7tv badge"]')?.getAttribute('src')).toBe('https://cdn.7tv.app/seven-badge.png');
    expect(container.querySelector('.ck-zw')).not.toBeNull();
    expect(container.querySelector('img[alt="BTTVGlobal"]')).not.toBeNull();
    expect(container.querySelector('img[alt="SevenZero"]')).not.toBeNull();
  });

  it('returns no demonstrations when all providers have no resources', () => {
    const empty: PreviewIdentityResponse = {
      identity: response().identity,
      providers: {
        Twitch: { status: 'loaded', resources: { globalBadges: {}, channelBadges: {} } },
        FFZ: { status: 'unavailable', resources: { globalEmotes: [], roomEmotes: [], badgeOverrides: {} } },
        BTTV: { status: 'failed', resources: { globalEmotes: [], channelEmotes: [], sharedEmotes: [] } },
        '7TV': { status: 'unavailable', resources: { globalEmotes: [], channelEmotes: [], personalEmotes: [], paint: null, badge: null } },
      },
    };
    expect(buildPreviewIdentityMessages(empty)).toEqual([]);
  });
});
