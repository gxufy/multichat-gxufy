/* Commands, executed — through each platform's real connector.
 *
 * The point of this file is that it does not construct a UnifiedMessage. Each
 * platform's ingestion runs for real: the Kick connector binds to a fake Pusher and
 * receives an actual `ChatMessageEvent` payload, the Twitch connector parses an
 * actual IRC line off a fake socket, the YouTube connector polls a fake InnerTube
 * response, and the TikTok connector reads an actual SSE frame. Whatever those
 * connectors build is what the dispatcher is handed.
 *
 * That distinction matters because the per-platform failure this guards against is
 * not "the parser cannot read the string" — it is "this platform's connector puts
 * the text somewhere else, or spells the moderator badge differently, so the
 * command silently never fires from that chat". Four calls to the parser with a
 * handwritten string would pass in exactly the world where that bug exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELOAD_COOLDOWN_MS,
  createMultichatCommandRunner,
  multichatAccessLevel,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import { MULTICHAT_COMMANDS } from '@/lib/multichatCommands';
import type { Connector, Platform, UnifiedMessage } from '@/lib/types';

/* ── Fake Pusher, for the Kick connector ── */

type Binding = (data: unknown) => void;
const pusherBindings = new Map<string, Map<string, Binding[]>>();

class FakePusherChannel {
  constructor(private readonly name: string) {}
  bind(event: string, cb: Binding) {
    const events = pusherBindings.get(this.name) ?? new Map<string, Binding[]>();
    events.set(event, [...(events.get(event) ?? []), cb]);
    pusherBindings.set(this.name, events);
    return this;
  }
}

class FakePusher {
  connection = { state: 'connected', bind: () => {} };
  subscribe(name: string) {
    return new FakePusherChannel(name);
  }
  channel(name: string) {
    return pusherBindings.has(name) ? new FakePusherChannel(name) : undefined;
  }
  disconnect() {}
}

vi.mock('pusher-js', () => ({ default: FakePusher }));

vi.mock('@/lib/kick', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getKickChannel: vi.fn(async () => ({
    id: 7,
    user_id: 77,
    chatroom: { id: 700 },
    user: { id: 77, username: 'streamer' },
    subscriber_badges: [],
  })),
}));

/* ── Fake WebSocket, for the Twitch connector ── */

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

/* ── Fake EventSource, for the TikTok connector ── */

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

/* ── The recording host ── */

type Recorded = {
  floats: { slot: number; message: string }[];
  removed: number[];
  mounted: { slot: number; el: HTMLElement; timeoutMs: number }[];
  removeAll: number;
  clears: number;
  pauseStates: boolean[];
  pauseToggles: number;
  visible: boolean[];
  platformVisible: { platform: Platform; visible: boolean }[];
  sharedVisible: boolean[];
  counterBackground: boolean[];
  reloads: number;
  refreshes: number;
  spoken: string[];
  stops: number;
};

function createHost(overrides: Partial<CommandHost> = {}) {
  const log: Recorded = {
    floats: [],
    removed: [],
    mounted: [],
    removeAll: 0,
    clears: 0,
    pauseStates: [],
    pauseToggles: 0,
    visible: [],
    platformVisible: [],
    sharedVisible: [],
    counterBackground: [],
    reloads: 0,
    refreshes: 0,
    spoken: [],
    stops: 0,
  };
  let stamp: number | null = null;
  let clock = 1_000_000;

  const host: CommandHost = {
    channels: { kick: 'streamer', twitch: 'streamer', youtube: 'streamer', tiktok: 'streamer' },
    getBroadcasterId: platform => platform === 'youtube' ? 'UC-broadcaster' : undefined,
    showFloat: (slot, message) => log.floats.push({ slot, message }),
    removeFloat: (slot) => log.removed.push(slot),
    removeAllFloats: () => { log.removeAll += 1; },
    clearChatMessages: () => { log.clears += 1; },
    setChatPresentationPaused: (paused) => log.pauseStates.push(paused),
    toggleChatPresentationPaused: () => { log.pauseToggles += 1; },
    mountFloat: (slot, el, timeoutMs) => log.mounted.push({ slot, el, timeoutMs }),
    createElement: (tag) => document.createElement(tag),
    setChatVisible: (visible) => log.visible.push(visible),
    setPlatformChatVisible: (platform, visible) => log.platformVisible.push({ platform, visible }),
    setSharedChatVisible: (visible) => log.sharedVisible.push(visible),
    setCounterBackground: (visible) => log.counterBackground.push(visible),
    reload: () => { log.reloads += 1; },
    refreshEmotes: async () => { log.refreshes += 1; },
    findEmoteUrl: (name) =>
      name === 'KEKW' ? 'https://cdn.7tv.app/emote/abc/4x.webp' : null,
    speak: (text) => log.spoken.push(text),
    stopSpeaking: () => { log.stops += 1; },
    readReloadStamp: () => stamp,
    writeReloadStamp: (at) => { stamp = at; },
    now: () => clock,
    ...overrides,
  };

  return {
    host,
    log,
    runner: createMultichatCommandRunner(host),
    advance: (ms: number) => { clock += ms; },
  };
}

/* ── Per-platform ingestion, using each real connector ── */

/* Connectors started earlier in a test are stopped before the next one starts.
   Without this, a live connector keeps polling whenever a later ingest advances
   the clock, and its extra deliveries are indistinguishable from a dispatch bug in
   the test being written. Real overlays replace a connector the same way. */
const active: Connector[] = [];

function retire(connector: Connector): Connector {
  active.push(connector);
  return connector;
}

function stopActive() {
  while (active.length) active.pop()!.stop();
  pusherBindings.clear();
}

/** Drives one platform's connector and delivers `text` as a chat message. */
type Ingest = (
  onMessage: (m: UnifiedMessage) => void,
  text: string,
  role: 'broadcaster' | 'moderator' | 'viewer',
  id?: string,
) => Promise<Connector>;

const KICK_BADGES = {
  broadcaster: [{ type: 'broadcaster' }],
  moderator: [{ type: 'moderator' }],
  viewer: [],
};

const ingestKick: Ingest = async (onMessage, text, role, id = 'k1') => {
  stopActive();
  const { createKickConnector } = await import('@/lib/connectors/kick');
  const connector = retire(createKickConnector({
    channel: 'streamer',
    onMessage,
    onDelete: () => {},
    onPin: () => {},
    onStatus: () => {},
  }));
  connector.start();
  await vi.waitFor(() => expect(pusherBindings.has('chatrooms.700.v2')).toBe(true));
  const handlers = pusherBindings.get('chatrooms.700.v2')!.get('App\\Events\\ChatMessageEvent')!;
  const sender = role === 'broadcaster'
    ? { username: 'StreamerDisplay', slug: 'streamer' }
    : role === 'moderator'
      ? { username: 'SomeModDisplay', slug: 'somemod' }
      : { username: 'streamer', slug: 'differentviewer' };
  for (const handler of handlers) {
    handler({
      id,
      content: text,
      sender: {
        id: 42,
        ...sender,
        identity: { color: '#fff', badges: KICK_BADGES[role] },
      },
    });
  }
  return connector;
};

const TWITCH_BADGES = {
  broadcaster: 'broadcaster/1',
  moderator: 'moderator/1',
  viewer: '',
};

const ingestTwitch: Ingest = async (onMessage, text, role, id = 't1') => {
  stopActive();
  const { createTwitchConnector } = await import('@/lib/connectors/twitch');
  const connector = retire(createTwitchConnector({
    channel: 'streamer',
    onMessage,
    onDelete: () => {},
    onPin: () => {},
    onStatus: () => {},
  }));
  connector.start();
  const socket = FakeSocket.last!;
  socket.onopen?.();
  const login = role === 'broadcaster' ? 'streamer' : role === 'moderator' ? 'somemod' : 'differentviewer';
  const displayName = role === 'broadcaster' ? 'StyledStreamer' : role === 'moderator' ? 'SomeMod' : 'streamer';
  socket.onmessage?.({
    data:
      `@badges=${TWITCH_BADGES[role]};display-name=${displayName};id=${id};user-id=9 ` +
      `:${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #streamer :${text}\r\n`,
  });
  return connector;
};

const YT_BADGES = {
  broadcaster: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }],
  moderator: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' } } }],
  viewer: [],
};

const ingestYouTube: Ingest = async (onMessage, text, role, id = 'y1') => {
  stopActive();
  const { createYouTubeConnector } = await import('@/lib/connectors/youtube');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
      if (url.includes('/api/youtube/live')) {
        return {
          ok: true,
          json: async () => ({
            videoId: 'v',
            apiKey: 'k',
            clientVersion: '2',
            continuation: 'c0',
            channelId: 'UC-broadcaster',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          continuationContents: {
            liveChatContinuation: {
              actions: [
                {
                  addChatItemAction: {
                    item: {
                      liveChatTextMessageRenderer: {
                        id,
                        /* YouTube may send handle-style author names. The command
                           runtime must keep accepting the upstream identity even
                           though the presentation model removes the display @. */
                        authorName: {
                          simpleText: role === 'broadcaster'
                            ? '@streamer'
                            : role === 'moderator'
                              ? '@somemod'
                              : '@streamer',
                        },
                        authorExternalChannelId: role === 'broadcaster'
                          ? 'UC-broadcaster'
                          : role === 'moderator'
                            ? 'UC-moderator'
                            : 'UC-attacker',
                        authorBadges: YT_BADGES[role],
                        /* Runs, not a flat string: this is the shape the real
                           InnerTube payload uses, and the connector flattening it
                           wrongly is exactly the per-platform break this catches. */
                        message: { runs: [{ text }] },
                      },
                    },
                  },
                },
              ],
              continuations: [{ timedContinuationData: { continuation: 'c1', timeoutMs: 1000 } }],
            },
          },
        }),
      } as Response;
    }),
  );

  const connector = retire(createYouTubeConnector({
    channel: 'streamer',
    onMessage,
    onDelete: () => {},
    onPin: () => {},
    onStatus: () => {},
  }));
  connector.start();
  /* The connector bootstraps, then schedules its first poll a second out. */
  await vi.advanceTimersByTimeAsync(1200);
  return connector;
};

const ingestTikTok: Ingest = async (onMessage, text, role, id = 'tt1') => {
  stopActive();
  const { createTikTokConnector } = await import('@/lib/connectors/tiktok');
  const connector = retire(createTikTokConnector({
    channel: 'streamer',
    onMessage,
    onDelete: () => {},
    onPin: () => {},
    onStatus: () => {},
  }));
  connector.start();
  FakeEventSource.last!.onmessage?.({
    data: JSON.stringify({
      type: 'chat',
      id,
      senderId: 's1',
      /* TikTok has no broadcaster badge at all. The streamer is recognized by
         uniqueId, never by the mutable display nickname. */
      senderUsername: role === 'broadcaster'
        ? 'streamer'
        : role === 'moderator'
          ? 'somemod'
          : 'differentviewer',
      username: role === 'broadcaster'
        ? 'CompletelyDifferent'
        : role === 'moderator'
          ? 'SomeModDisplay'
          : 'streamer',
      moderator: role === 'moderator',
      text,
    }),
  });
  return connector;
};

const PLATFORMS: readonly (readonly [string, Ingest])[] = [
  ['kick', ingestKick],
  ['twitch', ingestTwitch],
  ['youtube', ingestYouTube],
  ['tiktok', ingestTikTok],
];

beforeEach(() => {
  vi.useFakeTimers();
  active.length = 0;
  pusherBindings.clear();
  FakeSocket.last = null;
  FakeEventSource.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs `text` through one platform and returns the recording. */
async function run(
  ingest: Ingest,
  text: string,
  role: 'broadcaster' | 'moderator' | 'viewer' = 'moderator',
  overrides: Partial<CommandHost> = {},
) {
  const harness = createHost(overrides);
  const connector = await ingest((m) => harness.runner.handle(m), text, role);
  return { ...harness, connector };
}

describe('ingestion actually reaches the dispatcher', () => {
  /* Every "this must not fire" test below asserts an absence, and an absence is
     also what a broken fixture produces. These prove the pipeline is live and
     carries the text verbatim, so the negative assertions mean something. */
  for (const [platform, ingest] of PLATFORMS) {
    it(`delivers a ${platform} message with its text intact`, async () => {
      const seen: UnifiedMessage[] = [];
      await ingest((m) => { seen.push(m); }, 'hello !multichat world', 'moderator');
      expect(seen).toHaveLength(1);
      expect(seen[0].platform).toBe(platform);
      expect(seen[0].text).toBe('hello !multichat world');
      expect(seen[0].id).toBeTruthy();
    });

    it(`marks ${platform} roles the dispatcher can read`, async () => {
      const roles = ['broadcaster', 'moderator', 'viewer'] as const;
      const levels: number[] = [];
      for (const role of roles) {
        const seen: UnifiedMessage[] = [];
        await ingest((m) => { seen.push(m); }, 'hi', role);
        expect(seen, role).toHaveLength(1);
        levels.push(
          multichatAccessLevel(seen[0], {
            kick: 'streamer', twitch: 'streamer', youtube: 'streamer', tiktok: 'streamer',
          }),
        );
      }
      /* Fails closed for the viewer, and the two privileged roles are distinct
         from it — whatever spelling this platform uses for its badges. */
      expect(levels).toEqual([1000, 500, 0]);
    });
  }

  it.each([
    ['kick', ingestKick, 'streamer', 'StreamerDisplay'],
    ['twitch', ingestTwitch, 'streamer', 'StyledStreamer'],
    ['youtube', ingestYouTube, '@streamer', '@streamer'],
    ['tiktok', ingestTikTok, 'streamer', 'CompletelyDifferent'],
  ] as const)('keeps %s canonical and display names separate', async (
    _platform,
    ingest,
    senderUsername,
    username,
  ) => {
    const seen: UnifiedMessage[] = [];
    await ingest((message) => { seen.push(message); }, 'hello', 'broadcaster');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ senderUsername, username });
  });
});

describe('command message-kind guard', () => {
  function message(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
    return {
      platform: 'youtube',
      id: 'kind-guard',
      senderId: 'channel-owner',
      senderUsername: 'streamer',
      username: 'Streamer',
      color: '',
      badges: [{ type: 'owner' }],
      text: '!multichat clear',
      emotes: [],
      timestamp: 1,
      kind: 'system',
      category: 'announcement',
      ...overrides,
    };
  }

  it.each([
    ['broadcaster system event', { badges: [{ type: 'broadcaster' }] }],
    ['moderator system event', { badges: [{ type: 'moderator' }], senderUsername: 'somemod' }],
    ['announcement', { category: 'announcement' as const }],
    ['paid event', { category: 'cheer' as const, text: '!multichat tts do not speak' }],
    ['legacy trigger event', { category: 'gift' as const, text: '!kickchat clear' }],
  ])('rejects command-like text from a %s without side effects', (_label, overrides) => {
    const { runner, log } = createHost();
    const before = structuredClone(log);

    expect(runner.handle(message(overrides))).toBeNull();
    expect(log).toEqual(before);
  });

  it('returns before reading command text or observing non-chat identity', () => {
    const { runner, log } = createHost();
    const system = message({
      senderId: 'event-author',
      senderUsername: 'eventauthor',
      badges: [],
    });
    let textReads = 0;
    Object.defineProperty(system, 'text', {
      get() {
        textReads += 1;
        return '!multichat clear';
      },
    });

    expect(runner.handle(system)).toBeNull();
    expect(textReads).toBe(0);
    expect(runner.handle(message({
      id: 'permit-event-author',
      kind: 'chat',
      text: '!multichat permit eventauthor',
    }))?.name).toBe('permit');
    expect(log.floats.at(-1)?.message)
      .toBe('Permit failed: target must have spoken recently and match exactly.');
  });

  it.each([
    ['broadcaster', [{ type: 'broadcaster' }]],
    ['moderator', [{ type: 'moderator' }]],
  ])('keeps authorized %s ordinary chat commands working', (_role, badges) => {
    const { runner, log } = createHost();
    expect(runner.handle(message({
      id: `chat-${_role}`,
      kind: 'chat',
      badges,
    }))?.name).toBe('clear');
    expect(log.clears).toBe(1);
  });
});

describe('canonical broadcaster fallback', () => {
  function message(
    platform: Platform,
    overrides: Partial<UnifiedMessage>,
  ): UnifiedMessage {
    return {
      platform,
      id: `${platform}-identity`,
      senderId: 'different-user-id',
      username: 'VisibleName',
      color: '',
      badges: [],
      text: '!multichat clear',
      emotes: [],
      timestamp: 1,
      kind: 'chat',
      ...overrides,
    };
  }

  it.each([
    ['twitch', 'StreamerLogin'],
    ['kick', 'StreamerLogin'],
    ['tiktok', 'StreamerLogin'],
  ] as const)('uses the canonical %s account name, ignoring display styling', (platform, senderUsername) => {
    const candidate = message(platform, {
      senderUsername,
      username: 'A Completely Different Display Name',
    });
    expect(multichatAccessLevel(candidate, { [platform]: '@streamerlogin' })).toBe(1000);
  });

  it.each(['twitch', 'kick', 'youtube'] as const)(
    'does not let a %s display name override a different canonical account',
    (platform) => {
      const candidate = message(platform, {
        senderUsername: 'totallydifferentuser',
        username: 'realstreamer',
      });
      expect(multichatAccessLevel(candidate, { [platform]: 'realstreamer' })).toBe(0);
    },
  );

  it('rejects the TikTok nickname spoof and accepts the real uniqueId broadcaster', () => {
    const { runner, log } = createHost({ channels: { tiktok: 'realstreamer' } });
    const spoof = message('tiktok', {
      id: 'tiktok-spoof',
      senderId: 'some-other-user-id',
      senderUsername: 'totallydifferentuser',
      username: 'realstreamer',
    });
    const broadcaster = message('tiktok', {
      id: 'tiktok-broadcaster',
      senderId: 'real-broadcaster-id',
      senderUsername: 'realstreamer',
      username: 'Something Completely Different',
    });

    expect(runner.handle(spoof)).toBeNull();
    expect(log.clears).toBe(0);
    expect(runner.handle(broadcaster)?.name).toBe('clear');
    expect(log.clears).toBe(1);
  });

  it('fails closed for a YouTube display author when no canonical handle is available', () => {
    const candidate = message('youtube', {
      senderUsername: undefined,
      username: 'realstreamer',
    });
    expect(multichatAccessLevel(candidate, { youtube: 'realstreamer' })).toBe(0);
  });

  it('rejects a YouTube viewer whose handle matches the configured broadcaster', () => {
    const { runner, log } = createHost({
      channels: { youtube: '@ExampleChannel' },
      getBroadcasterId: () => 'UC-LegitimateBroadcaster',
    });
    const attacker = message('youtube', {
      id: 'youtube-handle-spoof',
      senderId: 'UC-Attacker',
      senderUsername: '@ExampleChannel',
      username: '@ExampleChannel',
      text: '!multichat permit someone',
    });

    expect(runner.handle(attacker)).toBeNull();
    expect(log.floats).toEqual([]);
  });

  it('authorizes a YouTube broadcaster by exact immutable channel id', () => {
    const { runner, log } = createHost({
      channels: { youtube: '@ExampleChannel' },
      getBroadcasterId: () => 'UC-LegitimateBroadcaster',
    });
    const broadcaster = message('youtube', {
      id: 'youtube-channel-id-match',
      senderId: 'UC-LegitimateBroadcaster',
      senderUsername: '@DifferentPresentationHandle',
      username: 'Different Display Name',
      text: '!multichat permit someone',
    });

    expect(runner.handle(broadcaster)?.name).toBe('permit');
    expect(log.floats.at(-1)?.message)
      .toBe('Permit failed: target must have spoken recently and match exactly.');
  });

  it('fails closed for YouTube when the immutable broadcaster id is unavailable', () => {
    const candidate = message('youtube', {
      senderId: 'UC-ExampleChannel',
      senderUsername: '@ExampleChannel',
      username: '@ExampleChannel',
    });

    expect(multichatAccessLevel(candidate, { youtube: '@ExampleChannel' })).toBe(0);
  });

  it('fails closed for YouTube when the immutable sender id is missing', () => {
    const candidate = message('youtube', {
      senderId: '',
      senderUsername: '@ExampleChannel',
      username: '@ExampleChannel',
    });

    expect(multichatAccessLevel(
      candidate,
      { youtube: '@ExampleChannel' },
      'UC-LegitimateBroadcaster',
    )).toBe(0);
  });

  it('rejects mismatched and case-folded YouTube immutable channel ids', () => {
    const candidate = message('youtube', {
      senderId: 'UC-ExampleChannel',
      senderUsername: '@ExampleChannel',
      username: '@ExampleChannel',
    });

    expect(multichatAccessLevel(
      candidate,
      { youtube: '@ExampleChannel' },
      'UC-DifferentChannel',
    )).toBe(0);
    expect(multichatAccessLevel(
      candidate,
      { youtube: '@ExampleChannel' },
      'UC-examplechannel',
    )).toBe(0);
  });

  it.each(['broadcaster', 'owner'] as const)('keeps the explicit %s badge authoritative', (type) => {
    const candidate = message('youtube', {
      senderUsername: undefined,
      username: 'Unrelated Display Name',
      badges: [{ type }],
    });
    expect(multichatAccessLevel(candidate, { youtube: 'realstreamer' })).toBe(1000);
  });

  it('keeps the explicit moderator badge authoritative without canonical identity', () => {
    const candidate = message('twitch', {
      senderUsername: undefined,
      username: 'Unrelated Display Name',
      badges: [{ type: 'moderator' }],
    });
    expect(multichatAccessLevel(candidate, { twitch: 'realstreamer' })).toBe(500);
  });
});

describe('runtime visibility controls', () => {
  it('maps platform, Shared Chat, and counter background commands onto their host controls', () => {
    const { runner, log } = createHost();
    const base: UnifiedMessage = {
      platform: 'twitch', id: 'ctl-0', senderId: '9', username: 'somemod', color: '',
      badges: [{ type: 'moderator' }], text: '', emotes: [], timestamp: 1, kind: 'chat',
    };
    const commands = [
      'kickoff', 'kickon', 'twitchoff', 'twitchon', 'youtubeoff', 'youtubeon',
      'tiktokoff', 'tiktokon', 'sharedoff', 'sharedon', 'counterbgoff', 'counterbgon',
    ];
    commands.forEach((name, index) => runner.handle({ ...base, id: `ctl-${index}`, text: `!multichat ${name}` }));
    expect(log.platformVisible).toEqual([
      { platform: 'kick', visible: false }, { platform: 'kick', visible: true },
      { platform: 'twitch', visible: false }, { platform: 'twitch', visible: true },
      { platform: 'youtube', visible: false }, { platform: 'youtube', visible: true },
      { platform: 'tiktok', visible: false }, { platform: 'tiktok', visible: true },
    ]);
    expect(log.sharedVisible).toEqual([false, true]);
    expect(log.counterBackground).toEqual([false, true]);
  });
});

describe('every command runs from every platform', () => {
  for (const [platform, ingest] of PLATFORMS) {
    describe(platform, () => {
      it('shows the ping notice', async () => {
        const { log } = await run(ingest, '!multichat ping');
        expect(log.floats.map((f) => f.message)).toEqual(['Pong!\nmultichat-gxufy']);
      });

      it('hides and shows the chat container', async () => {
        const hidden = await run(ingest, '!multichat hide');
        expect(hidden.log.visible).toEqual([false]);
        const shown = await run(ingest, '!multichat show');
        expect(shown.log.visible).toEqual([true]);
      });

      it('reloads the source', async () => {
        const { log } = await run(ingest, '!multichat reload');
        expect(log.reloads).toBe(1);
      });

      it('stops overlays and speech together', async () => {
        const { log } = await run(ingest, '!multichat stop');
        expect(log.removeAll).toBe(1);
        expect(log.stops).toBe(1);
      });

      it('clears ordinary chat history', async () => {
        for (const name of ['clear', 'cls']) {
          const { log } = await run(ingest, `!multichat ${name}`);
          expect(log.clears, name).toBe(1);
          expect(log.removeAll, name).toBe(0);
          expect(log.removed, name).toEqual([]);
          expect(log.mounted, name).toEqual([]);
          expect(log.spoken, name).toEqual([]);
          expect(log.stops, name).toBe(0);
          expect(log.visible, name).toEqual([]);
          expect(log.platformVisible, name).toEqual([]);
          expect(log.sharedVisible, name).toEqual([]);
          expect(log.counterBackground, name).toEqual([]);
        }
      });

      it('dispatches pause, resume, and toggle aliases without other side effects', async () => {
        for (const name of ['pause', 'freeze']) {
          const { log } = await run(ingest, `!multichat ${name}`);
          expect(log.pauseStates, name).toEqual([true]);
          expect(log.pauseToggles, name).toBe(0);
          expect(log.clears, name).toBe(0);
          expect(log.removeAll, name).toBe(0);
          expect(log.removed, name).toEqual([]);
          expect(log.mounted, name).toEqual([]);
          expect(log.spoken, name).toEqual([]);
          expect(log.stops, name).toBe(0);
          expect(log.visible, name).toEqual([]);
          expect(log.platformVisible, name).toEqual([]);
          expect(log.sharedVisible, name).toEqual([]);
          expect(log.counterBackground, name).toEqual([]);
        }
        for (const name of ['resume', 'play', 'unfreeze', 'unpause']) {
          const { log } = await run(ingest, `!multichat ${name}`);
          expect(log.pauseStates, name).toEqual([false]);
          expect(log.pauseToggles, name).toBe(0);
          expect(log.clears, name).toBe(0);
          expect(log.removeAll, name).toBe(0);
          expect(log.removed, name).toEqual([]);
          expect(log.mounted, name).toEqual([]);
          expect(log.spoken, name).toEqual([]);
          expect(log.stops, name).toBe(0);
          expect(log.visible, name).toEqual([]);
          expect(log.platformVisible, name).toEqual([]);
          expect(log.sharedVisible, name).toEqual([]);
          expect(log.counterBackground, name).toEqual([]);
        }
        for (const name of ['togglepause', 'tp']) {
          const { log } = await run(ingest, `!multichat ${name}`);
          expect(log.pauseStates, name).toEqual([]);
          expect(log.pauseToggles, name).toBe(1);
          expect(log.clears, name).toBe(0);
          expect(log.removeAll, name).toBe(0);
          expect(log.removed, name).toEqual([]);
          expect(log.mounted, name).toEqual([]);
          expect(log.spoken, name).toEqual([]);
          expect(log.stops, name).toBe(0);
          expect(log.visible, name).toEqual([]);
          expect(log.platformVisible, name).toEqual([]);
          expect(log.sharedVisible, name).toEqual([]);
          expect(log.counterBackground, name).toEqual([]);
        }
      });

      it('refreshes emotes', async () => {
        const { log } = await run(ingest, '!multichat refresh emotes');
        expect(log.refreshes).toBe(1);
      });

      it('mounts an image from a URL', async () => {
        const { log } = await run(ingest, '!multichat img https://example.com/a.png');
        expect(log.mounted).toHaveLength(1);
        expect(log.mounted[0].el.querySelector('img')!.src).toBe('https://example.com/a.png');
      });

      it('mounts a video from a preset', async () => {
        const { log } = await run(ingest, '!multichat yt rickroll');
        expect(log.mounted).toHaveLength(1);
        expect(log.mounted[0].el.querySelector('iframe')!.src).toContain('dQw4w9WgXcQ');
      });

      it('speaks tts text with the command stripped', async () => {
        const { log } = await run(ingest, '!multichat tts hello there');
        expect(log.spoken).toEqual(['hello there']);
      });

      it('accepts the legacy alias for every command', async () => {
        const { log } = await run(ingest, '!kickchat ping');
        expect(log.floats).toHaveLength(1);
      });

      it('runs each documented command name from this platform', async () => {
        /* The registry drives the loop, so a command added later is covered here
           without this file being edited — it will fail until it dispatches. The
           dispatched names are collected rather than asserted inside the callback,
           so a platform that delivers nothing at all fails on the comparison
           instead of passing an assertion that never ran. */
        const dispatched: (string | null)[] = [];
        for (const command of MULTICHAT_COMMANDS) {
          const argument =
            command.name === 'img'
              ? ' https://example.com/a.png'
              : command.name === 'yt'
                ? ' rickroll'
                : command.name === 'tts'
                  ? ' words'
                  : '';
          const harness = createHost();
          await ingest(
            (m) => { dispatched.push(harness.runner.handle(m)?.name ?? null); },
            `!multichat ${command.name}${argument}`,
            command.name === 'permit' || command.name === 'unpermit'
              ? 'broadcaster'
              : 'moderator',
          );
        }
        expect(dispatched).toEqual(MULTICHAT_COMMANDS.map((c) => c.name));
      });
    });
  }
});

describe('access, per platform', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`ignores an ordinary ${platform} viewer`, async () => {
      const { log } = await run(ingest, '!multichat ping', 'viewer');
      expect(log.floats).toEqual([]);
    });

    it(`accepts the ${platform} broadcaster`, async () => {
      const { log } = await run(ingest, '!multichat ping', 'broadcaster');
      expect(log.floats).toHaveLength(1);
    });

    it(`accepts a ${platform} moderator`, async () => {
      const { log } = await run(ingest, '!multichat ping', 'moderator');
      expect(log.floats).toHaveLength(1);
    });

    it(`applies the same access gate to clear from ${platform}`, async () => {
      const viewer = await run(ingest, '!multichat clear', 'viewer');
      const broadcaster = await run(ingest, '!multichat clear', 'broadcaster');
      const moderator = await run(ingest, '!multichat clear', 'moderator');
      expect(viewer.log.clears).toBe(0);
      expect(broadcaster.log.clears).toBe(1);
      expect(moderator.log.clears).toBe(1);
    });

    it(`applies the same access gate to pause controls from ${platform}`, async () => {
      for (const name of ['pause', 'resume', 'togglepause']) {
        const viewer = await run(ingest, `!multichat ${name}`, 'viewer');
        const broadcaster = await run(ingest, `!multichat ${name}`, 'broadcaster');
        const moderator = await run(ingest, `!multichat ${name}`, 'moderator');
        if (name === 'togglepause') {
          expect(viewer.log.pauseToggles, name).toBe(0);
          expect(broadcaster.log.pauseToggles, name).toBe(1);
          expect(moderator.log.pauseToggles, name).toBe(1);
        } else {
          const expected = name === 'pause';
          expect(viewer.log.pauseStates, name).toEqual([]);
          expect(broadcaster.log.pauseStates, name).toEqual([expected]);
          expect(moderator.log.pauseStates, name).toEqual([expected]);
        }
      }
    });
  }
});

describe('clear command aliases', () => {
  const base: UnifiedMessage = {
    platform: 'twitch', id: 'clear-alias', senderId: '9', username: 'somemod', color: '',
    badges: [{ type: 'moderator' }], text: '', emotes: [], timestamp: 1, kind: 'chat',
  };

  for (const text of [
    '!multichat clear',
    '!multichat cls',
    '!kickchat clear',
    '!kickchat cls',
  ]) {
    it(`normalizes ${text} to the canonical clear command`, () => {
      const { runner, log } = createHost();
      expect(runner.handle({ ...base, text })?.name).toBe('clear');
      expect(log.clears).toBe(1);
    });
  }
});

describe('pause command aliases', () => {
  const base: UnifiedMessage = {
    platform: 'twitch', id: 'pause-alias', senderId: '9', username: 'somemod', color: '',
    badges: [{ type: 'moderator' }], text: '', emotes: [], timestamp: 1, kind: 'chat',
  };
  const commands = [
    ['pause', 'pause', true, false],
    ['freeze', 'pause', true, false],
    ['resume', 'resume', false, false],
    ['play', 'resume', false, false],
    ['unfreeze', 'resume', false, false],
    ['unpause', 'resume', false, false],
    ['togglepause', 'togglepause', null, true],
    ['tp', 'togglepause', null, true],
  ] as const;

  for (const trigger of ['!multichat', '!kickchat']) {
    for (const [name, canonical, paused, toggled] of commands) {
      it(`normalizes ${trigger} ${name} to ${canonical}`, () => {
        const { runner, log } = createHost();
        expect(runner.handle({ ...base, text: `${trigger} ${name}` })?.name).toBe(canonical);
        expect(log.pauseStates).toEqual(paused === null ? [] : [paused]);
        expect(log.pauseToggles).toBe(toggled ? 1 : 0);
      });
    }
  }
});

describe('parsing, per platform', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`tolerates surrounding whitespace from ${platform}`, async () => {
      const { log } = await run(ingest, '   !multichat ping   ');
      expect(log.floats).toHaveLength(1);
    });

    it(`folds command casing from ${platform}`, async () => {
      const { log } = await run(ingest, '!MultiChat PING');
      expect(log.floats).toHaveLength(1);
    });

    it(`does not execute a command merely mentioned from ${platform}`, async () => {
      for (const text of [
        'you can type !multichat hide to hide it',
        '!multichatting hide',
        '!multichats stop',
        'hide',
      ]) {
        const { log } = await run(ingest, text);
        expect(log.visible, text).toEqual([]);
        expect(log.removeAll, text).toBe(0);
      }
    });

    it(`keeps argument casing and unicode intact from ${platform}`, async () => {
      const { log } = await run(ingest, '!multichat tts Héllo Wörld ツ');
      expect(log.spoken).toEqual(['Héllo Wörld ツ']);
    });

    it(`ignores an unknown command from ${platform}`, async () => {
      const { log } = await run(ingest, '!multichat explode');
      expect(log.floats).toEqual([]);
      expect(log.reloads).toBe(0);
      expect(log.removeAll).toBe(0);
    });

    it(`ignores a bare trigger from ${platform}`, async () => {
      const { log } = await run(ingest, '!multichat');
      expect(log.floats).toEqual([]);
    });
  }
});

describe('one message dispatches once', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`does not run twice when ${platform} redelivers the same message`, async () => {
      /* A real occurrence rather than a hypothetical: YouTube re-polls with the
         previous continuation token after a failed request, and the TikTok hub
         replays its recent buffer to a reconnecting subscriber. */
      const harness = createHost();
      const deliver = (m: UnifiedMessage) => harness.runner.handle(m);
      await ingest(deliver, '!multichat ping', 'moderator');
      await ingest(deliver, '!multichat ping', 'moderator');
      expect(harness.log.floats).toHaveLength(1);
    });

    it(`still accepts a distinct later command from ${platform}`, async () => {
      /* Same runner, two ingested messages with different ids — the dedupe must be
         per message, not a one-command-per-session lock. */
      const harness = createHost();
      const deliver = (m: UnifiedMessage) => harness.runner.handle(m);
      await ingest(deliver, '!multichat ping', 'moderator', 'first');
      await ingest(deliver, '!multichat ping', 'moderator', 'second');
      expect(harness.log.floats).toHaveLength(2);
    });
  }

  it('does not dispatch twice when several platforms are configured', async () => {
    /* Every connector calls the same runner, which is how the overlay wires them.
       Two platforms carrying two different messages must produce two dispatches,
       and neither may double-fire. */
    const harness = createHost();
    const deliver = (m: UnifiedMessage) => harness.runner.handle(m);
    await ingestKick(deliver, '!multichat ping', 'moderator', 'k-1');
    await ingestTwitch(deliver, '!multichat ping', 'moderator', 't-1');
    expect(harness.log.floats).toHaveLength(2);
  });

  it('clears only once when the same command delivery is duplicated', () => {
    const { runner, log } = createHost();
    const message: UnifiedMessage = {
      platform: 'twitch', id: 'same-clear', senderId: '9', username: 'somemod', color: '',
      badges: [{ type: 'moderator' }], text: '!multichat clear', emotes: [],
      timestamp: 1, kind: 'chat',
    };
    expect(runner.handle(message)?.name).toBe('clear');
    expect(runner.handle(message)).toBeNull();
    expect(log.clears).toBe(1);
  });

  it('toggles pause only once when the same command delivery is duplicated', () => {
    const { runner, log } = createHost();
    const message: UnifiedMessage = {
      platform: 'twitch', id: 'same-togglepause', senderId: '9', username: 'somemod', color: '',
      badges: [{ type: 'moderator' }], text: '!multichat tp', emotes: [],
      timestamp: 1, kind: 'chat',
    };
    expect(runner.handle(message)?.name).toBe('togglepause');
    expect(runner.handle(message)).toBeNull();
    expect(log.pauseToggles).toBe(1);
  });
});

describe('media safety, from real chat text', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`refuses an unsafe scheme sent from ${platform}`, async () => {
      for (const link of [
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==',
        'file:///etc/passwd',
      ]) {
        const { log } = await run(ingest, `!multichat img ${link}`);
        expect(log.mounted, link).toEqual([]);
      }
    });

    it(`cannot inject markup through an image URL from ${platform}`, async () => {
      /* The historical defect: this string closed the src attribute in an
         innerHTML template and ran script. Through the DOM it is just a URL that
         happens to contain quotes, and no extra element can appear. */
      const hostile = 'https://example.com/a.png" onerror="alert(1)';
      const { log } = await run(ingest, `!multichat img ${hostile}`);
      expect(log.mounted).toHaveLength(1);
      const wrapper = log.mounted[0].el;
      expect(wrapper.querySelectorAll('*')).toHaveLength(1);
      expect(wrapper.querySelector('img')!.getAttribute('onerror')).toBeNull();
    });

    it(`clears a mounted image on request from ${platform}`, async () => {
      const { log } = await run(ingest, '!multichat img clear');
      expect(log.removed).toEqual([4]);
      expect(log.mounted).toEqual([]);
    });

    it(`ignores img and yt with no usable argument from ${platform}`, async () => {
      for (const text of ['!multichat img', '!multichat img notanemote', '!multichat yt', '!multichat yt nope']) {
        const { log } = await run(ingest, text);
        expect(log.mounted, text).toEqual([]);
      }
    });

    it(`ignores empty tts text from ${platform}`, async () => {
      const { log } = await run(ingest, '!multichat tts');
      expect(log.spoken).toEqual([]);
    });
  }
});

describe('reload cooldown, across a real reconnect', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`does not reload twice within the cooldown from ${platform}`, async () => {
      /* The stamp is the shared persistent one, so this models the actual loop
         risk: the source reloads, the connector reconnects, and the platform
         replays the same command to a brand-new runner. */
      let stamp: number | null = null;
      let clock = 5_000_000;
      const overrides: Partial<CommandHost> = {
        readReloadStamp: () => stamp,
        writeReloadStamp: (at) => { stamp = at; },
        now: () => clock,
      };

      const first = await run(ingest, '!multichat reload', 'moderator', overrides);
      expect(first.log.reloads).toBe(1);

      clock += RELOAD_COOLDOWN_MS - 1;
      const second = await run(ingest, '!multichat reload', 'moderator', overrides);
      expect(second.log.reloads).toBe(0);

      clock += 2;
      const third = await run(ingest, '!multichat reload', 'moderator', overrides);
      expect(third.log.reloads).toBe(1);
    });
  }
});

describe('teardown', () => {
  for (const [platform, ingest] of PLATFORMS) {
    it(`delivers nothing to the runner after the ${platform} connector stops`, async () => {
      const harness = createHost();
      const connector = await ingest(
        (m) => harness.runner.handle(m),
        '!multichat ping',
        'moderator',
      );
      connector.stop();
      expect(harness.log.floats).toHaveLength(1);
      /* Whatever the transport does after stop(), a further command must not
         reach the overlay. Advancing well past every reconnect delay in the
         connectors covers the retry paths too. */
      await vi.advanceTimersByTimeAsync(70_000);
      expect(harness.log.floats).toHaveLength(1);
    });
  }
});
