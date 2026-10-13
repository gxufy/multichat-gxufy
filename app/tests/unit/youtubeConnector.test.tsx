import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { createYouTubeConnector, parseRuns } from '@/lib/connectors/youtube';
import { NO_COSMETICS, buildParsedMessage } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';
import type { UnifiedMessage, UnifiedPin } from '@/lib/types';
import { youtubeBootstrap, youtubeContinuation } from '../fixtures/youtubeInnerTube';

function connectFixture() {
  const messages: UnifiedMessage[] = [];
  const deletes: { id?: string; senderId?: string }[] = [];
  const pins: (UnifiedPin | null)[] = [];
  const statuses: string[] = [];
  let chatPolls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    if (url.includes('/api/youtube/live')) {
      return { ok: true, status: 200, json: async () => youtubeBootstrap } as Response;
    }
    const continuation = chatPolls++ === 0
      ? youtubeContinuation
      : {
          continuationContents: {
            liveChatContinuation: {
              actions: [],
              continuations: [{ timedContinuationData: { continuation: 'continuation-next', timeoutMs: 1000 } }],
            },
          },
        };
    return { ok: true, status: 200, json: async () => continuation } as Response;
  }));
  const connector = createYouTubeConnector({
    channel: 'IShowSpeed',
    onMessage: (message) => messages.push(message),
    onDelete: (deletion) => deletes.push(deletion),
    onPin: (pin) => pins.push(pin),
    onStatus: (status) => statuses.push(status),
  });
  connector.start();
  return { connector, messages, deletes, pins, statuses };
}

function parsed(messages: UnifiedMessage[]): ParsedMessage[] {
  const mentions = { enabled: true, colors: new Map<string, string>() };
  return messages.map((message, index) => buildParsedMessage(
    message,
    { sevenTVEmotesEnabled: true, sevenTVCosmeticsEnabled: true, paintShadows: true },
    NO_COSMETICS,
    mentions,
    index,
  ));
}

beforeEach(() => {
  vi.useFakeTimers();
  /* The main normalization fixture carries an explicit Aug 2024 provider
     timestamp. Put this suite's browser-source baseline just before it so these
     tests exercise current-session parsing/delivery; startup-history suppression
     is covered separately by connectorStartupHistory.test.ts with an old+new pair. */
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('YouTube InnerTube ingestion', () => {
  it('paces one continuation in provider order instead of releasing the whole YouTube batch at once', async () => {
    const fixture = connectFixture();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.messages.map(message => message.id)).toEqual(['yt-normal']);
    await vi.advanceTimersByTimeAsync(750);
    expect(fixture.messages.map(message => message.id)).toEqual([
      'yt-normal', 'yt-fallback', 'yt-super-chat', 'yt-super-sticker', 'yt-membership', 'yt-gift',
    ]);
    expect(fixture.messages.some(message => message.kind === 'system')).toBe(true);
    fixture.connector.stop();
  });

  it('never releases a message deleted later in the same continuation', async () => {
    const deletedContinuation = {
      continuationContents: {
        liveChatContinuation: {
          actions: [
            { addChatItemAction: { item: { liveChatTextMessageRenderer: {
              id: 'queued-delete', authorName: { simpleText: 'User' },
              authorExternalChannelId: 'UC-delete', message: { simpleText: 'do not show' },
            } } } },
            { removeChatItemAction: { targetItemId: 'queued-delete' } },
          ],
          continuations: [{ timedContinuationData: { continuation: 'next', timeoutMs: 1000 } }],
        },
      },
    };
    const messages: UnifiedMessage[] = [];
    const deletes: { id?: string; senderId?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true, status: 200,
      json: async () => String(input).includes('/api/youtube/live') ? youtubeBootstrap : deletedContinuation,
    }) as Response));
    const connector = createYouTubeConnector({
      channel: 'channel', onMessage: message => messages.push(message),
      onDelete: deletion => deletes.push(deletion), onPin: vi.fn(), onStatus: vi.fn(),
    });
    connector.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(messages).toEqual([]);
    expect(deletes).toEqual([{ id: 'queued-delete' }]);
    connector.stop();
  });

  it('keeps Unicode offsets correct and preserves custom-emote fallback text', () => {
    const result = parseRuns([
      { text: '😀 before ' },
      {
        emoji: {
          emojiId: 'UC1/party', shortcuts: [':party:'], isCustomEmoji: true,
          image: { thumbnails: [{ url: 'https://yt.example/party.png', width: 32, height: 32 }] },
        },
      },
      { text: ' and ' },
      {
        emoji: {
          emojiId: 'UC1/noart', shortcuts: [':noart:'], isCustomEmoji: true,
          image: { thumbnails: [{ url: 'data:image/png;base64,nope', width: 64, height: 64 }] },
        },
      },
      { emoji: { emojiId: '❤️', isCustomEmoji: false } },
    ]);

    expect(result.text).toBe('😀 before party and noart❤️');
    expect(result.emotes).toEqual([{
      begin: 9, end: 14, text: 'party', url: 'https://yt.example/party.png',
    }]);
  });

  it('normalizes realistic chat, badge, avatar, event, deletion, and pin actions', async () => {
    const fixture = connectFixture();
    await vi.advanceTimersByTimeAsync(2400);
    fixture.connector.stop();

    expect(fixture.statuses).toEqual(['connecting', 'connected']);
    expect(fixture.messages.map((message) => message.id)).toEqual([
      'yt-normal', 'yt-fallback', 'yt-super-chat', 'yt-super-sticker', 'yt-membership', 'yt-gift',
    ]);
    expect(fixture.deletes).toEqual([{ id: 'yt-deleted' }, { senderId: 'UC-banned' }]);
    expect(fixture.pins.map((pin) => pin?.message.id ?? null)).toEqual(['yt-pin', null]);

    const normal = fixture.messages[0];
    expect(normal.username).toBe('@SpeedFan');
    expect(normal.senderUsername).toBe('@SpeedFan');
    expect(normal.senderId).toBe('UC-speed-fan');
    expect(normal.avatar).toBe('https://yt.example/avatar=s160-c-k-c0x00ffffff-no-rj');
    expect(normal.badges).toEqual([
      { type: 'verified' },
      { type: 'owner' },
      { type: 'moderator' },
      { type: 'subscriber', url: 'https://yt.example/member-32.png' },
    ]);
    expect(normal.text).toBe('Hi 😀 before party middle wave after 🎉❤️');
    expect(normal.emotes.map((emote) => ({ text: emote.text, begin: emote.begin, end: emote.end, url: emote.url }))).toEqual([
      { text: 'party', begin: 12, end: 17, url: 'https://yt.example/party-48.png' },
      { text: 'wave', begin: 25, end: 29, url: 'https://yt.example/wave-48.png' },
    ]);
    expect(fixture.messages[1]).toMatchObject({
      text: 'broken noart stays readable', emotes: [],
    });
    expect(fixture.messages[1].senderUsername).toBeUndefined();

    expect(fixture.messages[2]).toMatchObject({
      kind: 'system', category: 'cheer', text: 'SpeedFan sent a $25.00 Super Chat: Great stream party',
    });
    expect(fixture.messages[2].emotes).toHaveLength(1);
    expect(fixture.messages[3]).toMatchObject({
      kind: 'system', category: 'cheer', text: 'SpeedFan sent a $10.00 Super Sticker! Hype sticker',
    });
    expect(fixture.messages[3].emotes[0].url).toBe('https://yt.example/sticker-96.png');
    expect(fixture.messages[4]).toMatchObject({
      kind: 'system', category: 'subscription',
      text: 'SpeedFan became a member wave: Glad to be here',
    });
    expect(fixture.messages[5]).toMatchObject({
      kind: 'system', category: 'gift', text: 'SpeedFan gifted 5 memberships party',
    });
    expect(fixture.messages.slice(2).every((message) => message.avatar === normal.avatar)).toBe(true);
    expect(fixture.messages.slice(2).every((message) => message.badges.length === 4)).toBe(true);
  });

  it('renders ingested YouTube identity, source, badges, avatar, and emotes through the shared overlay', async () => {
    const fixture = connectFixture();
    await vi.advanceTimersByTimeAsync(2400);
    fixture.connector.stop();
    const [normal] = parsed(fixture.messages);

    expect(normal.identity.username).toBe('SpeedFan');
    expect((normal.raw as UnifiedMessage).username).toBe('@SpeedFan');
    expect(normal.senderId).toBe('UC-speed-fan');
    expect(normal.identity.namePill).toBe('#ffd600|#111111');

    const config = MultichatQuerySchema.parse({ youtube: 'IShowSpeed', showAvatars: 'true', animation: 'none' });
    const view = render(
      <ChatOverlay
        config={config}
        messages={[normal]}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit={false}
      />,
    );
    await act(async () => {});

    expect(view.container.querySelector('[data-source-tag="icon"][data-platform="youtube"]')).not.toBeNull();
    expect(view.container.textContent).toContain('SpeedFan:');
    expect(view.container.textContent).not.toContain('@SpeedFan:');
    const badgeImages = Array.from(view.container.querySelectorAll('.ck-badge-img')) as HTMLImageElement[];
    expect(badgeImages.map((image) => image.alt)).toEqual(['verified', 'moderator', 'subscriber']);
    expect(badgeImages[2].src).toBe('https://yt.example/member-32.png');
    const emotes = Array.from(view.container.querySelectorAll('.ck-body img.ck-emote')) as HTMLImageElement[];
    expect(emotes.map((image) => image.alt)).toEqual(['\u{1F600}', 'party', 'wave', '\u{1F389}', '\u2764\uFE0F']);
    const avatar = view.container.querySelector('img[src*="avatar=s160"]') as HTMLImageElement;
    expect(avatar).not.toBeNull();
    fireEvent.error(avatar);
    expect(avatar.style.display).toBe('none');
  });

  it('renders normalized YouTube paid and membership events with shared source chrome', async () => {
    const fixture = connectFixture();
    await vi.advanceTimersByTimeAsync(2400);
    fixture.connector.stop();
    const events = parsed(fixture.messages.filter((message) => message.kind === 'system'));
    const config = MultichatQuerySchema.parse({ youtube: 'IShowSpeed', animation: 'none' });
    const view = render(
      <ChatOverlay
        config={config}
        messages={events}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit={false}
      />,
    );
    await act(async () => {});

    expect(view.container.querySelectorAll('[data-source-tag="icon"][data-platform="youtube"]')).toHaveLength(4);
    expect(view.container.textContent).toContain('$25.00 Super Chat');
    expect(view.container.textContent).toContain('$10.00 Super Sticker');
    expect(view.container.textContent).toContain('became a member');
    expect(view.container.textContent).toContain('gifted 5 memberships');
    expect(view.container.querySelectorAll('.ck-body img.ck-emote').length).toBeGreaterThanOrEqual(4);
  });
});
