import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MultichatPage from '@/pages/multichat';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import type { ParsedMessage } from '@/lib/kick';
import {
  MULTICHAT_MAX_MESSAGE_LINES,
  MULTICHAT_GENERATOR_DEFAULTS,
  MultichatQuerySchema,
  buildMultichatQuery,
} from '@/lib/multichatConfig';
import {
  loadRestoredMultichatMessages,
  multichatMessageStorageKey,
  saveRestoredMultichatMessages,
} from '@/lib/multichatMessagePersistence';
import { resetRuntimeAnimationState } from '@/lib/multichatAnimationRuntime';
import type { ConnectorCallbacks, UnifiedMessage } from '@/lib/types';

let query: Record<string, string | string[]> = {};
const twitchCallbacks: ConnectorCallbacks[] = [];
const loadTwitchEmotesMock = vi.hoisted(function () { return vi.fn(); });
const twitchConnectorMocks = vi.hoisted(function () {
  return { start: vi.fn(), stop: vi.fn() };
});

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query, replace: vi.fn() }),
}));
vi.mock('../../src/lib/twitchEmotes', function () {
  return { loadTwitchEmotes: loadTwitchEmotesMock };
});
vi.mock('../../src/components/overlay/ChatOverlay', () => ({
  __esModule: true,
  default: ({ messages }: { messages: ParsedMessage[] }) => (
    <div data-testid="restored-overlay" data-count={messages.length}>
      {messages.map((message) => <span key={message.id} data-testid={"message-" + message.id} data-id={message.id} data-timestamp={String(message.timestamp)} data-content={JSON.stringify(message.message)} data-suppress-entry-animation={String(Boolean(message.suppressEntryAnimation))}>{message.identity.username}</span>)}
    </div>
  ),
  FONT_FAMILIES: {},
}));
vi.mock('../../src/components/classic/ClassicGenerator', () => ({
  __esModule: true,
  default: () => <div />,
}));
vi.mock('../../src/lib/connectors/kick', () => ({
  createKickConnector: () => ({ start() {}, stop() {} }),
}));
vi.mock('../../src/lib/connectors/twitch', () => ({
  createTwitchConnector: (callbacks: ConnectorCallbacks) => {
    twitchCallbacks.push(callbacks);
    return {
      start: twitchConnectorMocks.start,
      stop: twitchConnectorMocks.stop,
    };
  },
}));
vi.mock('../../src/lib/connectors/youtube', () => ({
  createYouTubeConnector: () => ({ start() {}, stop() {} }),
}));
vi.mock('../../src/lib/connectors/tiktok', () => ({
  createTikTokConnector: () => ({ start() {}, stop() {} }),
}));
vi.mock('../../src/lib/cosmetics', () => ({
  createCosmeticsFetcher: () => ({ want() {}, stop() {} }),
}));
vi.mock('../../src/lib/twitchPinPoller', () => ({
  startTwitchPinPoller: () => () => {},
}));

const channels = { kick: '', twitch: 'somechannel', youtube: '', tiktok: '' };

function rawMessage(id: string): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId: `sender-${id}`,
    username: `User ${id}`,
    color: '#9146ff',
    badges: [],
    text: `message ${id}`,
    emotes: [],
    timestamp: Date.now(),
    kind: 'chat',
  };
}

function moderatorCommand(id: string, text: string): UnifiedMessage {
  return {
    ...rawMessage(id),
    username: 'Some Moderator',
    badges: [{ type: 'moderator' }],
    text,
  };
}

function broadcasterCommand(id: string, text: string): UnifiedMessage {
  return {
    ...rawMessage(id),
    senderId: 'channel-owner-id',
    senderUsername: 'somechannel',
    username: 'Channel Owner',
    badges: [{ type: 'broadcaster' }],
    text,
  };
}

function permissionViewerMessage(id: string, text: string): UnifiedMessage {
  return {
    ...rawMessage(id),
    senderId: 'temporary-viewer-id',
    senderUsername: 'alice',
    username: 'Alice Display',
    text,
  };
}

function parsedMessage(id: string, displayedAt = Date.now()): ParsedMessage {
  const raw = rawMessage(id);
  return {
    id: `twitch:${id}`,
    platform: 'twitch',
    senderId: raw.senderId,
    raw,
    timestamp: displayedAt,
    identity: {
      username: raw.username,
      color: raw.color,
      background: '',
      filter: '',
      badges: [],
    },
    message: [raw.text],
  };
}

beforeEach(() => {
  query = {};
  twitchCallbacks.length = 0;
  twitchConnectorMocks.start.mockReset();
  twitchConnectorMocks.stop.mockReset();
  loadTwitchEmotesMock.mockReset();
  loadTwitchEmotesMock.mockResolvedValue([]);
  window.sessionStorage.clear();
  resetRuntimeAnimationState();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  resetRuntimeAnimationState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('restoreOnReload config', () => {
  it('defaults off and accepts only explicit true values', () => {
    const defaults = MultichatQuerySchema.parse({});
    expect(defaults.restoreOnReload).toBe(false);
    expect(defaults.maxMessageLines).toBe(100);
    expect(defaults.maxMessageAge).toBe(0);
    expect(MultichatQuerySchema.parse({ restoreOnReload: 'true' }).restoreOnReload).toBe(true);
    expect(MultichatQuerySchema.parse({ restoreOnReload: '1' }).restoreOnReload).toBe(true);
    expect(MultichatQuerySchema.parse({ restoreOnReload: 'false' }).restoreOnReload).toBe(false);
  });

  it('normalizes restore message limits and age values', () => {
    expect(MultichatQuerySchema.parse({ maxMessageLines: '25' }).maxMessageLines).toBe(25);
    expect(MultichatQuerySchema.parse({ maxMessageLines: '0' }).maxMessageLines).toBe(1);
    expect(MultichatQuerySchema.parse({ maxMessageLines: '101' }).maxMessageLines).toBe(100);
    expect(MultichatQuerySchema.parse({ maxMessageLines: 'nope' }).maxMessageLines).toBe(100);

    expect(MultichatQuerySchema.parse({ maxMessageAge: '300' }).maxMessageAge).toBe(300);
    expect(MultichatQuerySchema.parse({ maxMessageAge: '0' }).maxMessageAge).toBe(0);
    expect(MultichatQuerySchema.parse({ maxMessageAge: '-1' }).maxMessageAge).toBe(0);
    expect(MultichatQuerySchema.parse({ maxMessageAge: 'nope' }).maxMessageAge).toBe(0);
  });

  it('omits the default and serializes the opt-in explicitly', () => {
    const off = new URLSearchParams(buildMultichatQuery(channels, MULTICHAT_GENERATOR_DEFAULTS));
    const on = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_GENERATOR_DEFAULTS,
      restoreOnReload: true,
    }));
    expect(off.has('restoreOnReload')).toBe(false);
    expect(on.get('restoreOnReload')).toBe('true');
  });

  it('serializes restore limits only while reload restoration is enabled', () => {
    const off = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_GENERATOR_DEFAULTS,
      restoreOnReload: false,
      maxMessageLines: '25',
      maxMessageAge: '300',
    }));

    const defaultsOn = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_GENERATOR_DEFAULTS,
      restoreOnReload: true,
    }));

    const customOn = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_GENERATOR_DEFAULTS,
      restoreOnReload: true,
      maxMessageLines: '25',
      maxMessageAge: '300',
    }));

    expect(off.has('restoreOnReload')).toBe(false);
    expect(off.has('maxMessageLines')).toBe(false);
    expect(off.has('maxMessageAge')).toBe(false);

    expect(defaultsOn.get('restoreOnReload')).toBe('true');
    expect(defaultsOn.has('maxMessageLines')).toBe(false);
    expect(defaultsOn.has('maxMessageAge')).toBe(false);

    expect(customOn.get('restoreOnReload')).toBe('true');
    expect(customOn.get('maxMessageLines')).toBe('25');
    expect(customOn.get('maxMessageAge')).toBe('300');
  });

  it('normalizes saved workspace state back to the off default', () => {
    expect(normalizeMultichatStyle({ restoreOnReload: true }).restoreOnReload).toBe(true);
    expect(normalizeMultichatStyle({ restoreOnReload: 'yes' as never }).restoreOnReload).toBe(false);
  });
});

describe('session message persistence', () => {
  const config = MultichatQuerySchema.parse({ twitch: 'SomeChannel' });
  const key = multichatMessageStorageKey(config);

  it('keys history by normalized channel identity rather than appearance', () => {
    const sameChannel = MultichatQuerySchema.parse({
      twitch: '@somechannel',
      textSize: 'large',
      replyStyle: 'off',
    });
    const otherChannel = MultichatQuerySchema.parse({ twitch: 'someoneelse' });
    expect(multichatMessageStorageKey(sameChannel)).toBe(key);
    expect(multichatMessageStorageKey(otherChannel)).not.toBe(key);
  });

  it('round-trips raw messages and their original display timestamps', () => {
    const message = parsedMessage('saved', 123_456);
    saveRestoredMultichatMessages(window.sessionStorage, key, [message]);
    expect(loadRestoredMultichatMessages(window.sessionStorage, key)).toEqual([{
      raw: message.raw,
      displayedAt: 123_456,
    }]);
  });

  it('caps history at 100 and discards malformed storage', () => {
    const messages = Array.from({ length: 105 }, (_, index) => parsedMessage(String(index), index));
    saveRestoredMultichatMessages(window.sessionStorage, key, messages);
    const restored = loadRestoredMultichatMessages(window.sessionStorage, key);
    expect(restored).toHaveLength(100);
    expect(restored[0]!.raw.id).toBe('5');

    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, messages: [{ raw: {} }] }));
    expect(loadRestoredMultichatMessages(window.sessionStorage, key)).toEqual([]);
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it('applies configured message limits on both save and load', () => {
    const messages = Array.from(
      { length: 6 },
      (_, index) => parsedMessage(String(index), 10_000 + index),
    );

    saveRestoredMultichatMessages(
      window.sessionStorage,
      key,
      messages,
      { maxMessages: 4, now: 20_000 },
    );

    expect(
      loadRestoredMultichatMessages(window.sessionStorage, key)
        .map((message) => message.raw.id),
    ).toEqual(['2', '3', '4', '5']);

    expect(
      loadRestoredMultichatMessages(
        window.sessionStorage,
        key,
        { maxMessages: 2, now: 20_000 },
      ).map((message) => message.raw.id),
    ).toEqual(['4', '5']);
  });

  it('filters expired messages while saving and while loading an existing cache', () => {
    const now = 100_000;
    const old = parsedMessage('old', now - 10_000);
    const recent = parsedMessage('recent', now - 2_000);

    saveRestoredMultichatMessages(
      window.sessionStorage,
      key,
      [old, recent],
      { maxAgeSeconds: 5, now },
    );

    expect(
      loadRestoredMultichatMessages(window.sessionStorage, key)
        .map((message) => message.raw.id),
    ).toEqual(['recent']);

    saveRestoredMultichatMessages(
      window.sessionStorage,
      key,
      [old, recent],
      { now },
    );

    expect(
      loadRestoredMultichatMessages(
        window.sessionStorage,
        key,
        { maxAgeSeconds: 5, now },
      ).map((message) => message.raw.id),
    ).toEqual(['recent']);
  });
});

describe('overlay reload restoration', () => {
  const enabledConfig = MultichatQuerySchema.parse({
    twitch: 'somechannel',
    restoreOnReload: 'true',
  });
  const storageKey = multichatMessageStorageKey(enabledConfig);

  it('publishes connector messages on the fixed 200ms presentation clock', () => {
    vi.useFakeTimers();
    query = { twitch: 'somechannel' };
    render(<MultichatPage />);
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');

    act(() => twitchCallbacks[0]!.onMessage(rawMessage('fixed-clock')));
    expect(screen.queryByText('User fixed-clock')).toBeNull();
    act(() => vi.advanceTimersByTime(199));
    expect(screen.queryByText('User fixed-clock')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('User fixed-clock')).toBeTruthy();
  });

  it('clears the presentation clock before a queued row can publish on unmount', () => {
    vi.useFakeTimers();
    query = { twitch: 'somechannel' };
    const mounted = render(<MultichatPage />);

    act(() => twitchCallbacks[0]!.onMessage(rawMessage('pending-unmount')));
    mounted.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('User pending-unmount')).toBeNull();
  });

  it('restores saved rows only when the option is enabled', async () => {
    saveRestoredMultichatMessages(
      window.sessionStorage,
      storageKey,
      [parsedMessage('saved')],
    );

    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    const enabled = render(<MultichatPage />);
    expect((await screen.findByText('User saved')).getAttribute('data-suppress-entry-animation'))
      .toBe('true');
    enabled.unmount();

    query = { twitch: 'somechannel' };
    render(<MultichatPage />);
    expect((await screen.findByTestId('restored-overlay')).getAttribute('data-count')).toBe('0');
    expect(screen.queryByText('User saved')).toBeNull();
  });

  it('flushes a live message on unmount and restores it on the next mount', async () => {
    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    const first = render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    expect(twitchCallbacks).toHaveLength(1);

    act(() => twitchCallbacks[0]!.onMessage(rawMessage('live')));
    first.unmount();
    expect(loadRestoredMultichatMessages(window.sessionStorage, storageKey)
      .map((message) => message.raw.id)).toEqual(['live']);

    twitchCallbacks.length = 0;
    render(<MultichatPage />);
    expect(await screen.findByText('User live')).toBeTruthy();
  });

  it('restores message history without restoring temporary command permissions', async () => {
    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    const first = render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const firstCallbacks = twitchCallbacks[0]!;

    act(() => {
      firstCallbacks.onMessage(permissionViewerMessage('alice-seen', 'hello'));
      firstCallbacks.onMessage(broadcasterCommand('permit-alice', '!multichat permit alice'));
      firstCallbacks.onMessage(permissionViewerMessage('alice-clear', '!multichat clear'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');
    });

    act(() => firstCallbacks.onMessage(rawMessage('persisted-after-permit')));
    expect(await screen.findByText('User persisted-after-permit')).toBeTruthy();
    first.unmount();

    twitchCallbacks.length = 0;
    render(<MultichatPage />);
    expect(await screen.findByText('User persisted-after-permit')).toBeTruthy();
    act(() => twitchCallbacks[0]!.onMessage(
      permissionViewerMessage('alice-clear-after-reload', '!multichat clear'),
    ));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(screen.getByText('User persisted-after-permit')).toBeTruthy();
  });

  it('clear removes displayed, pending, backing, and persisted rows without reconnecting', async () => {
    const unrelatedConfig = MultichatQuerySchema.parse({ youtube: 'otherchannel' });
    const unrelatedKey = multichatMessageStorageKey(unrelatedConfig);
    saveRestoredMultichatMessages(
      window.sessionStorage,
      unrelatedKey,
      [parsedMessage('unrelated')],
    );

    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    const first = render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    expect(twitchCallbacks).toHaveLength(1);

    act(() => twitchCallbacks[0]!.onMessage(rawMessage('visible')));
    expect(await screen.findByText('User visible')).toBeTruthy();

    /* Queue one more ordinary row and clear before the next presentation frame.
       If only React's displayed array were emptied, this pending row would
       reappear on that frame. */
    act(() => {
      twitchCallbacks[0]!.onMessage(rawMessage('pending'));
      twitchCallbacks[0]!.onMessage(moderatorCommand('clear', '!multichat cls'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');
    expect(screen.queryByText('User visible')).toBeNull();
    expect(screen.queryByText('User pending')).toBeNull();
    expect(screen.queryByText('Some Moderator')).toBeNull();

    /* The clear command does not tear down or recreate the live provider. */
    expect(twitchConnectorMocks.start).toHaveBeenCalledTimes(1);
    expect(twitchConnectorMocks.stop).not.toHaveBeenCalled();
    expect(twitchCallbacks).toHaveLength(1);

    /* Persistence is cleared synchronously and only for this channel identity. */
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(loadRestoredMultichatMessages(window.sessionStorage, unrelatedKey))
      .toHaveLength(1);

    first.unmount();
    twitchCallbacks.length = 0;
    render(<MultichatPage />);
    await waitFor(() => {
      expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');
    });

    /* A fresh message after the clear follows the normal presentation path. */
    act(() => twitchCallbacks[0]!.onMessage(rawMessage('after-clear')));
    expect(await screen.findByText('User after-clear')).toBeTruthy();
  });

  it('applies maxMessageLines and maxMessageAge while restoring the overlay', async () => {
    const now = Date.now();

    saveRestoredMultichatMessages(
      window.sessionStorage,
      storageKey,
      [
        parsedMessage('recent-1', now - 4_000),
        parsedMessage('recent-2', now - 3_000),
        parsedMessage('recent-3', now - 2_000),
        parsedMessage('recent-4', now - 1_000),
        parsedMessage('expired', now - 20_000),
      ],
    );

    query = {
      twitch: 'somechannel',
      restoreOnReload: 'true',
      maxMessageLines: '2',
      maxMessageAge: '5',
    };

    render(<MultichatPage />);

    expect(await screen.findByText('User recent-3')).toBeTruthy();
    expect(screen.getByText('User recent-4')).toBeTruthy();
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('2');

    expect(screen.queryByText('User recent-1')).toBeNull();
    expect(screen.queryByText('User recent-2')).toBeNull();
    expect(screen.queryByText('User expired')).toBeNull();
  });

  it('rebuilds restored Twitch rows when room emotes arrive late without duplicates or identity changes', async function () {
    const saved = parsedMessage('late-emote', 123_456);
    saved.raw = { ...(saved.raw as UnifiedMessage), text: 'LateEmote' };
    saved.message = ['LateEmote'];
    saveRestoredMultichatMessages(window.sessionStorage, storageKey, [saved]);

    let resolveEmotes!: (value: any) => void;
    loadTwitchEmotesMock.mockReturnValueOnce(new Promise(function (resolve) {
      resolveEmotes = resolve;
    }));

    query = {
      twitch: 'somechannel',
      restoreOnReload: 'true',
      sevenTVEmotesEnabled: 'true',
      sevenTVCosmeticsEnabled: 'false',
    };
    render(<MultichatPage />);

    const before = await screen.findByTestId('message-twitch:late-emote');
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('1');
    expect(before.getAttribute('data-id')).toBe('twitch:late-emote');
    expect(before.getAttribute('data-timestamp')).toBe('123456');
    expect(before.getAttribute('data-content')).toContain('LateEmote');
    expect(before.getAttribute('data-content')).not.toContain('cdn.7tv.app/emote/test/4x.webp');

    await act(async function () {
      const roomLoad = (twitchCallbacks[0] as any).onRoomId('123456');
      resolveEmotes([{
        name: 'LateEmote',
        image: 'https://cdn.7tv.app/emote/test/4x.webp',
        height: 28,
        width: 28,
        zeroWidth: false,
        upscale: false,
      }]);
      await roomLoad;
    });

    await waitFor(function () {
      expect(screen.getByTestId('message-twitch:late-emote').getAttribute('data-content'))
        .toContain('cdn.7tv.app/emote/test/4x.webp');
    });

    const after = screen.getByTestId('message-twitch:late-emote');
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('1');
    expect(after.getAttribute('data-id')).toBe('twitch:late-emote');
    expect(after.getAttribute('data-timestamp')).toBe('123456');
  });

});

describe('runtime pause and resume presentation', () => {
  const enabledConfig = MultichatQuerySchema.parse({
    twitch: 'somechannel',
    restoreOnReload: 'true',
  });
  const storageKey = multichatMessageStorageKey(enabledConfig);

  it('keeps existing rows visible, buffers ordinary chat in order, and resumes each row once', async () => {
    query = { twitch: 'somechannel' };
    render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const callbacks = twitchCallbacks[0]!;

    act(() => callbacks.onMessage(rawMessage('visible')));
    expect(await screen.findByText('User visible')).toBeTruthy();

    act(() => {
      callbacks.onMessage(moderatorCommand('pause', '!multichat freeze'));
      callbacks.onMessage(rawMessage('paused-1'));
      callbacks.onMessage(rawMessage('paused-2'));
      callbacks.onMessage({
        ...rawMessage('system-event'),
        kind: 'system',
        category: 'announcement',
      });
    });
    expect(await screen.findByText('User system-event')).toBeTruthy();
    expect(screen.getByText('User visible')).toBeTruthy();
    expect(screen.queryByText('User paused-1')).toBeNull();
    expect(screen.queryByText('User paused-2')).toBeNull();
    expect(screen.queryByText('Some Moderator')).toBeNull();

    act(() => callbacks.onMessage(moderatorCommand('resume', '!multichat play')));
    expect(await screen.findByText('User paused-2')).toBeTruthy();
    const usernames = Array.from(
      screen.getByTestId('restored-overlay').querySelectorAll('span'),
      (node) => node.textContent,
    );
    expect(usernames).toEqual([
      'User visible',
      'User system-event',
      'User paused-1',
      'User paused-2',
    ]);
    expect(screen.getAllByText('User paused-1')).toHaveLength(1);
    expect(screen.getAllByText('User paused-2')).toHaveLength(1);

    /* Resume while already running is harmless, and later traffic follows the
       normal presentation path without reconnecting the provider. */
    act(() => {
      callbacks.onMessage(moderatorCommand('resume-again', '!multichat resume'));
      callbacks.onMessage(rawMessage('after-resume'));
    });
    expect(await screen.findByText('User after-resume')).toBeTruthy();
    expect(screen.getAllByText('User paused-1')).toHaveLength(1);
    expect(twitchConnectorMocks.start).toHaveBeenCalledTimes(1);
    expect(twitchConnectorMocks.stop).not.toHaveBeenCalled();
  });

  it('bounds the pause buffer at the existing message ceiling and drops its oldest entries', async () => {
    query = { twitch: 'somechannel' };
    render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const callbacks = twitchCallbacks[0]!;

    act(() => callbacks.onMessage(rawMessage('visible')));
    expect(await screen.findByText('User visible')).toBeTruthy();
    act(() => {
      callbacks.onMessage(moderatorCommand('pause-bound', '!multichat pause'));
      for (let index = 0; index < MULTICHAT_MAX_MESSAGE_LINES + 5; index += 1) {
        callbacks.onMessage(rawMessage(`buffer-${index}`));
      }
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    /* Buffer overflow itself never evicts an already-presented row. */
    expect(screen.getByText('User visible')).toBeTruthy();
    expect(screen.queryByText('User buffer-104')).toBeNull();

    act(() => callbacks.onMessage(moderatorCommand('resume-bound', '!multichat resume')));
    await waitFor(() => {
      expect(screen.getByTestId('restored-overlay').getAttribute('data-count'))
        .toBe(String(MULTICHAT_MAX_MESSAGE_LINES));
    });
    for (let index = 0; index < 5; index += 1) {
      expect(screen.queryByText(`User buffer-${index}`)).toBeNull();
    }
    expect(screen.getByText('User buffer-5')).toBeTruthy();
    expect(screen.getByText('User buffer-104')).toBeTruthy();
  });

  it('repeated toggles alternate between buffering and normal presentation', async () => {
    query = { twitch: 'somechannel' };
    render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const callbacks = twitchCallbacks[0]!;

    act(() => {
      callbacks.onMessage(moderatorCommand('toggle-1', '!multichat tp'));
      callbacks.onMessage(rawMessage('toggle-buffer-1'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByText('User toggle-buffer-1')).toBeNull();

    act(() => callbacks.onMessage(moderatorCommand('toggle-2', '!multichat togglepause')));
    expect(await screen.findByText('User toggle-buffer-1')).toBeTruthy();

    act(() => {
      callbacks.onMessage(moderatorCommand('toggle-3', '!multichat togglepause'));
      callbacks.onMessage(rawMessage('toggle-buffer-2'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByText('User toggle-buffer-2')).toBeNull();

    act(() => callbacks.onMessage(moderatorCommand('toggle-4', '!multichat tp')));
    expect(await screen.findByText('User toggle-buffer-2')).toBeTruthy();
    expect(screen.getAllByText('User toggle-buffer-1')).toHaveLength(1);
    expect(screen.getAllByText('User toggle-buffer-2')).toHaveLength(1);
  });

  it('clear empties visible and paused history while leaving presentation paused', async () => {
    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const callbacks = twitchCallbacks[0]!;

    act(() => callbacks.onMessage(rawMessage('visible-before-clear')));
    expect(await screen.findByText('User visible-before-clear')).toBeTruthy();
    act(() => {
      callbacks.onMessage(moderatorCommand('pause-clear', '!multichat pause'));
      callbacks.onMessage(rawMessage('buffered-before-clear'));
      callbacks.onMessage(moderatorCommand('clear-paused', '!multichat clear'));
      callbacks.onMessage(rawMessage('buffered-after-clear'));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.getByTestId('restored-overlay').getAttribute('data-count')).toBe('0');
    expect(screen.queryByText('User visible-before-clear')).toBeNull();
    expect(screen.queryByText('User buffered-before-clear')).toBeNull();
    expect(screen.queryByText('User buffered-after-clear')).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    act(() => callbacks.onMessage(moderatorCommand('resume-clear', '!multichat unpause')));
    expect(await screen.findByText('User buffered-after-clear')).toBeTruthy();
    expect(screen.queryByText('User buffered-before-clear')).toBeNull();
    expect(screen.queryByText('User visible-before-clear')).toBeNull();
  });

  it('keeps paused rows out of restore storage and resets pause state on remount', async () => {
    query = { twitch: 'somechannel', restoreOnReload: 'true' };
    const first = render(<MultichatPage />);
    expect(await screen.findByTestId('restored-overlay')).toBeTruthy();
    const callbacks = twitchCallbacks[0]!;

    act(() => callbacks.onMessage(rawMessage('persisted-visible')));
    expect(await screen.findByText('User persisted-visible')).toBeTruthy();
    act(() => {
      callbacks.onMessage(moderatorCommand('pause-persist', '!multichat pause'));
      callbacks.onMessage(rawMessage('not-persisted'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(loadRestoredMultichatMessages(window.sessionStorage, storageKey)
      .map((message) => message.raw.id)).toEqual(['persisted-visible']);

    first.unmount();
    expect(loadRestoredMultichatMessages(window.sessionStorage, storageKey)
      .map((message) => message.raw.id)).toEqual(['persisted-visible']);

    twitchCallbacks.length = 0;
    render(<MultichatPage />);
    expect(await screen.findByText('User persisted-visible')).toBeTruthy();
    expect(screen.queryByText('User not-persisted')).toBeNull();
    act(() => twitchCallbacks[0]!.onMessage(rawMessage('after-reload')));
    expect(await screen.findByText('User after-reload')).toBeTruthy();
  });
});
