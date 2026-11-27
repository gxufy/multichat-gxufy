/* 7TV event routing and chatters' personal 7TV emotes. Event shapes are the
   ones 7TV's event stream sends on a busy channel (entitlement EMOTE_SET,
   emote_set.create, emote_set.update with pushed emotes). */
import { partsToHtml } from '@/lib/render/elementTree';
import { describe, expect, it } from 'vitest';
import { routeSevenTVDispatch } from '@/lib/sevenTVEventRouting';
import { SevenTVPersonalEmoteStore, withPersonalEmotes } from '@/lib/sevenTVPersonalEmotes';
import { buildParsedMessage, NO_COSMETICS, type MessageCosmetics } from '@/lib/multichatMessageModel';
import type { SevenTVEmote } from '@/lib/kick';
import type { UnifiedMessage } from '@/lib/types';

const CHANNEL_SET = '01FE9DRF000009TR6M9N941CYW';
const PERSONAL_SET = '01KAY8SHD31MDFYZMGC0D7005G';

const entitlement = (setId: string, twitchId: string, kickId?: string) => ({
  id: '00000000000000000000000000',
  kind: 'EMOTE_SET',
  ref_id: setId,
  user: {
    id: '01H323S3KR0003R5HDPVDSNRGJ',
    connections: [
      { id: twitchId, platform: 'TWITCH' },
      ...(kickId ? [{ id: kickId, platform: 'KICK' }] : []),
    ],
  },
});

const activeEmote = (id: string, name: string) => ({
  id, name, flags: 0,
  data: {
    id, name, flags: 1,
    host: { url: `//cdn.7tv.app/emote/${id}`, files: [{ name: '4x.webp', format: 'WEBP', width: 128, height: 128 }] },
  },
});

const pushed = (setId: string, ...emotes: Array<[string, string]>) => ({
  id: setId,
  kind: 3,
  pushed: emotes.map(([id, name], index) => ({ key: 'emotes', index, type: 'object', value: activeEmote(id, name) })),
});

describe('which 7TV events reload the channel', () => {
  const ctx = { activeSetId: CHANNEL_SET, stvUserId: CHANNEL_SET };

  it('reloads only for the channel\'s own set', () => {
    expect(routeSevenTVDispatch({ type: 'emote_set.update', body: { id: CHANNEL_SET } }, ctx)).toBe('channel-set');
    expect(routeSevenTVDispatch({ type: 'emote_set.update', body: { id: PERSONAL_SET } }, ctx)).toBe('personal-set');
    expect(routeSevenTVDispatch({ type: 'emote_set.create', body: { id: PERSONAL_SET } }, ctx)).toBe('personal-set');
    expect(routeSevenTVDispatch({ type: 'emote_set.delete', body: { id: CHANNEL_SET } }, ctx)).toBe('channel-set');
    /* Without an id we cannot tell whose set it is: keep reloading, as before. */
    expect(routeSevenTVDispatch({ type: 'emote_set.update', body: {} }, ctx)).toBe('channel-set');
  });

  it('treats every set as a chatter\'s when the channel has no 7TV set', () => {
    expect(routeSevenTVDispatch({ type: 'emote_set.update', body: { id: PERSONAL_SET } }, { activeSetId: null, stvUserId: null }))
      .toBe('personal-set');
  });

  it('re-resolves the channel only for the broadcaster\'s own user update', () => {
    expect(routeSevenTVDispatch({ type: 'user.update', body: { id: CHANNEL_SET } }, ctx)).toBe('broadcaster-user');
    expect(routeSevenTVDispatch({ type: 'user.update', body: { id: 'someone-else' } }, ctx)).toBe('other');
    expect(routeSevenTVDispatch({ type: 'entitlement.create', body: {} }, ctx)).toBe('other');
    expect(routeSevenTVDispatch(null, ctx)).toBe('other');
  });
});

describe('personal 7TV emote store', () => {
  it('links a chatter to their set and collects its emotes, in any event order', () => {
    const store = new SevenTVPersonalEmoteStore();
    expect(store.createSet({ id: PERSONAL_SET, object: { id: PERSONAL_SET, flags: 11 } })).toEqual([]);
    expect(store.updateSet(pushed(PERSONAL_SET, ['e1', 'nnysClap']))).toEqual([]);
    expect(store.entitlement(true, entitlement(PERSONAL_SET, '547623882', '106790'), 'twitch')).toEqual(['twitch:547623882']);
    expect(store.byUser['twitch:547623882'].map((e) => e.name)).toEqual(['nnysClap']);
    expect(store.byUser['twitch:547623882'][0].image).toBe('https://cdn.7tv.app/emote/e1/4x.webp');
    /* The Kick connection is only linked from a Kick stream. */
    expect(store.byUser['kick:106790']).toBeUndefined();

    /* Entitlement first, emotes later. */
    const other = new SevenTVPersonalEmoteStore();
    expect(other.entitlement(true, entitlement(PERSONAL_SET, '1'), 'twitch')).toEqual([]);
    expect(other.updateSet(pushed(PERSONAL_SET, ['e2', 'nnysBop']))).toEqual(['twitch:1']);
    expect(other.byUser['twitch:1'].map((e) => e.name)).toEqual(['nnysBop']);
  });

  it('follows pulls, deletes and lost entitlements', () => {
    const store = new SevenTVPersonalEmoteStore();
    store.entitlement(true, entitlement(PERSONAL_SET, '1'), 'twitch');
    store.updateSet(pushed(PERSONAL_SET, ['e1', 'A'], ['e2', 'B']));
    expect(store.byUser['twitch:1'].map((e) => e.name)).toEqual(['A', 'B']);
    expect(store.updateSet({ id: PERSONAL_SET, pulled: [{ key: 'emotes', old_value: { id: 'e1', name: 'A' } }] })).toEqual(['twitch:1']);
    expect(store.byUser['twitch:1'].map((e) => e.name)).toEqual(['B']);
    expect(store.entitlement(false, entitlement(PERSONAL_SET, '1'), 'twitch')).toEqual(['twitch:1']);
    expect(store.byUser['twitch:1']).toBeUndefined();
    store.entitlement(true, entitlement(PERSONAL_SET, '1'), 'twitch');
    expect(store.deleteSet({ id: PERSONAL_SET })).toEqual(['twitch:1']);
    expect(store.byUser['twitch:1']).toBeUndefined();
  });

  it('stays bounded on long streams', () => {
    const store = new SevenTVPersonalEmoteStore(10, 10);
    for (let i = 0; i < 100; i += 1) {
      store.entitlement(true, entitlement(`set-${i}`, String(i)), 'twitch');
      store.updateSet(pushed(`set-${i}`, [`e${i}`, `E${i}`]));
    }
    expect(Object.keys(store.byUser).length).toBeLessThanOrEqual(20);
  });
});

describe('personal emotes in messages', () => {
  const channelEmote: SevenTVEmote = { name: 'KEKW', image: 'https://cdn.7tv.app/emote/kekw/4x.webp', width: 32, height: 32, zeroWidth: false, upscale: false };
  const personalEmote: SevenTVEmote = { name: 'nnysClap', image: 'https://cdn.7tv.app/emote/clap/4x.webp', width: 32, height: 32, zeroWidth: false, upscale: false };
  const clash: SevenTVEmote = { ...personalEmote, name: 'KEKW', image: 'https://cdn.7tv.app/emote/fake-kekw/4x.webp' };

  const line = (senderId: string, text: string, extra: Partial<UnifiedMessage> = {}): UnifiedMessage => ({
    platform: 'twitch', id: `m-${senderId}-${text}`, senderId, username: `user${senderId}`, color: '#ffffff',
    badges: [], text, emotes: [], timestamp: 1, kind: 'chat', ...extra,
  });
  const cosmetics: MessageCosmetics = {
    ...NO_COSMETICS,
    emotes: { twitch: [channelEmote] },
    personalEmotes: { 'twitch:1': [personalEmote, clash] },
  };
  const html = (message: UnifiedMessage, emotesOn = true) => partsToHtml(
    buildParsedMessage(message, { sevenTVEmotesEnabled: emotesOn, sevenTVCosmeticsEnabled: true, paintShadows: true }, cosmetics,
      { enabled: false, colors: new Map() }, 1).message);

  it('shows a chatter\'s personal emote in their own messages only', () => {
    expect(html(line('1', 'hi nnysClap'))).toContain('clap/4x.webp');
    expect(html(line('2', 'hi nnysClap'))).not.toContain('clap/4x.webp');
    expect(html(line('1', 'hi nnysClap'), false)).not.toContain('clap/4x.webp');
  });

  it('keeps the channel\'s emote on a name clash', () => {
    const out = html(line('1', 'KEKW'));
    expect(out).toContain('kekw/4x.webp');
    expect(out).not.toContain('fake-kekw');
  });

  it('memoises the combined list per pair of lists', () => {
    const channel = [channelEmote];
    const personal = [personalEmote];
    expect(withPersonalEmotes(channel, personal)).toBe(withPersonalEmotes(channel, personal));
    expect(withPersonalEmotes(channel, undefined)).toBe(channel);
    expect(withPersonalEmotes(channel, [])).toBe(channel);
  });
});
