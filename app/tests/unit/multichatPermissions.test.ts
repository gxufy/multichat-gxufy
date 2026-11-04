import { afterEach, describe, expect, it } from 'vitest';
import {
  MULTICHAT_PERMIT_LIMIT,
  MULTICHAT_RECENT_IDENTITY_LIMIT,
  MULTICHAT_RECENT_IDENTITY_TTL_MS,
  createMultichatCommandRunner,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import { resetRuntimeAnimationState } from '@/lib/multichatAnimationRuntime';
import { resetRuntimeEventVisibility } from '@/lib/multichatEventRuntime';
import type { Platform, UnifiedMessage } from '@/lib/types';

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  let now = 1_000_000;
  const log = {
    floats: [] as string[],
    clears: 0,
    pauseStates: [] as boolean[],
    pauseToggles: 0,
    chatVisible: [] as boolean[],
    platformVisible: [] as Array<{ platform: Platform; visible: boolean }>,
    sharedVisible: [] as boolean[],
    counterBackground: [] as boolean[],
    reloads: 0,
    refreshes: 0,
    removeAll: 0,
    spoken: [] as string[],
    stops: 0,
    mounted: 0,
  };
  const host: CommandHost = {
    channels: { twitch: 'streamer', kick: 'streamer', youtube: 'streamer', tiktok: 'streamer' },
    showFloat: (_slot, message) => log.floats.push(message),
    removeFloat: () => {},
    removeAllFloats: () => { log.removeAll += 1; },
    clearChatMessages: () => { log.clears += 1; },
    setChatPresentationPaused: (paused) => log.pauseStates.push(paused),
    toggleChatPresentationPaused: () => { log.pauseToggles += 1; },
    mountFloat: () => { log.mounted += 1; },
    createElement: (tag) => document.createElement(tag),
    setChatVisible: (visible) => log.chatVisible.push(visible),
    setPlatformChatVisible: (platform, visible) => log.platformVisible.push({ platform, visible }),
    setSharedChatVisible: (visible) => log.sharedVisible.push(visible),
    setCounterBackground: (visible) => log.counterBackground.push(visible),
    reload: () => { log.reloads += 1; },
    refreshEmotes: async () => { log.refreshes += 1; },
    findEmoteUrl: () => 'https://cdn.example/emote.png',
    speak: (text) => log.spoken.push(text),
    stopSpeaking: () => { log.stops += 1; },
    readReloadStamp: () => null,
    writeReloadStamp: () => {},
    now: () => now,
  };
  return {
    log,
    host,
    runner: createMultichatCommandRunner(host),
    advance(ms: number) { now += ms; },
  };
}

let sequence = 0;

function viewer(
  platform: Platform,
  senderId: string,
  senderUsername: string,
  text = 'ordinary chat',
  username = senderUsername,
): UnifiedMessage {
  sequence += 1;
  return {
    platform,
    id: `viewer-${sequence}`,
    senderId,
    ...(senderUsername ? { senderUsername } : {}),
    username,
    color: '',
    badges: [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function broadcaster(
  text: string,
  id = `broadcaster-${++sequence}`,
  platform: Platform = 'twitch',
): UnifiedMessage {
  return {
    platform,
    id,
    senderId: `${platform}-owner-id`,
    senderUsername: 'streamer',
    username: 'Streamer Display',
    color: '',
    badges: [{ type: platform === 'youtube' ? 'owner' : 'broadcaster' }],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function moderator(text: string, id = `moderator-${++sequence}`): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId: 'twitch-moderator-id',
    senderUsername: 'somemod',
    username: 'Some Mod',
    color: '',
    badges: [{ type: 'moderator' }],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function remember(harness: Harness, message: UnifiedMessage): void {
  expect(harness.runner.handle(message)).toBeNull();
}

function grant(
  harness: Harness,
  target: UnifiedMessage,
  command = `!multichat permit ${target.senderUsername || target.username}`,
): void {
  remember(harness, target);
  expect(harness.runner.handle(broadcaster(command))?.name).toBe('permit');
}

function lastNotice(harness: Harness): string {
  return harness.log.floats[harness.log.floats.length - 1] ?? '';
}

afterEach(() => {
  resetRuntimeAnimationState();
  resetRuntimeEventVisibility();
});

describe('temporary permission management', () => {
  it('lets a native broadcaster grant and immediately revoke a recent viewer', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'user-1', 'alice', 'hello', 'Alice Display');
    grant(harness, alice);
    expect(lastNotice(harness)).toBe('Permitted: twitch:@alice');

    expect(harness.runner.handle({ ...alice, id: 'alice-ping', text: '!multichat ping' })?.name).toBe('ping');
    expect(harness.runner.handle(broadcaster('!multichat unpermit alice'))?.name).toBe('unpermit');
    expect(lastNotice(harness)).toBe('Revoked: twitch:@alice');
    expect(harness.runner.handle({ ...alice, id: 'alice-ping-after', text: '!multichat ping' })).toBeNull();
  });

  it('blocks moderators and viewers from grant/revoke while allowing native moderators to list', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'user-1', 'alice');
    remember(harness, alice);

    expect(harness.runner.handle(moderator('!multichat permit alice'))).toBeNull();
    expect(harness.runner.handle({ ...alice, id: 'viewer-grant', text: '!multichat permit alice' })).toBeNull();
    expect(harness.runner.handle(broadcaster('!multichat permit alice'))?.name).toBe('permit');
    expect(harness.runner.handle(moderator('!multichat permitted'))?.name).toBe('permitted');
    expect(lastNotice(harness)).toBe('Permitted: twitch:@alice');
    expect(harness.runner.handle(moderator('!multichat unpermit alice'))).toBeNull();
    expect(harness.runner.handle({ ...alice, id: 'viewer-list', text: '!multichat permitted' })).toBeNull();
    expect(harness.runner.handle({ ...alice, id: 'viewer-revoke', text: '!multichat unpermit alice' })).toBeNull();
  });

  it('supports management aliases and legacy trigger forms', () => {
    for (const permitAlias of ['permit', 'grant', 'allow']) {
      const harness = createHarness();
      const alice = viewer('twitch', `user-${permitAlias}`, 'alice');
      remember(harness, alice);
      expect(harness.runner.handle(broadcaster(`!kickchat ${permitAlias} alice`))?.name).toBe('permit');
      for (const listAlias of ['permitted', 'perms', 'permissions']) {
        expect(harness.runner.handle(moderator(`!kickchat ${listAlias}`))?.name).toBe('permitted');
      }
      const revokeAlias = permitAlias === 'permit' ? 'unpermit' : permitAlias === 'grant' ? 'revoke' : 'deny';
      expect(harness.runner.handle(broadcaster(`!kickchat ${revokeAlias} alice`))?.name).toBe('unpermit');
    }
  });

  it('rejects self-permit as redundant', () => {
    const harness = createHarness();
    expect(harness.runner.handle(broadcaster('!multichat permit streamer'))?.name).toBe('permit');
    expect(lastNotice(harness)).toBe('Permit failed: cannot permit yourself.');
  });
});

describe('permission target resolution', () => {
  for (const platform of ['twitch', 'kick'] as const) {
    it(`permits a ${platform} reply target by its real reply sender id`, () => {
      const harness = createHarness();
      const command = broadcaster('!multichat permit', `reply-${platform}`, platform);
      command.reply = {
        senderId: `${platform}-reply-id`,
        username: 'Reply Display',
        text: 'quoted body is not identity',
      };
      expect(harness.runner.handle(command)?.name).toBe('permit');
      expect(lastNotice(harness)).toBe(`Permitted: ${platform}:@Reply Display`);

      const renamed = viewer(platform, `${platform}-reply-id`, 'renamed-login', '!multichat ping', 'Renamed Display');
      expect(harness.runner.handle(renamed)?.name).toBe('ping');
      const sameLabelDifferentId = viewer(platform, `${platform}-other-id`, 'other-login', '!multichat ping', 'Reply Display');
      expect(harness.runner.handle(sameLabelDifferentId)).toBeNull();
    });
  }

  it('never infers reply identity from quoted text or a reply without senderId', () => {
    const harness = createHarness();
    const command = broadcaster('!multichat permit');
    command.reply = { username: 'alice', text: 'alice said hello' };
    expect(harness.runner.handle(command)?.name).toBe('permit');
    expect(lastNotice(harness)).toBe('Permit failed: target must have spoken recently and match exactly.');
  });

  it('resolves an exact same-platform canonical or display name', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'user-1', 'alice_login', 'hello', 'Alice Display');
    remember(harness, alice);
    expect(harness.runner.handle(broadcaster('!multichat permit Alice Display'))?.name).toBe('permit');
    expect(harness.runner.handle({ ...alice, id: 'allowed-by-display', text: '!multichat clear' })?.name).toBe('clear');
  });

  it('supports a platform-qualified cross-provider target', () => {
    const harness = createHarness();
    const youtubeBob = viewer('youtube', 'UC-Bob', '@SomeHandle', 'hello', 'Bob Display');
    remember(harness, youtubeBob);
    expect(harness.runner.handle(broadcaster('!multichat permit youtube:@somehandle'))?.name).toBe('permit');
    expect(lastNotice(harness)).toBe('Permitted: youtube:@SomeHandle');
    expect(harness.runner.handle({ ...youtubeBob, id: 'youtube-bob-ping', text: '!multichat ping' })?.name).toBe('ping');
  });

  it('keeps equal Twitch and Kick labels as separate immutable-id permits', () => {
    const harness = createHarness();
    const twitchBob = viewer('twitch', 'twitch-bob-id', 'bob');
    const kickBob = viewer('kick', 'kick-bob-id', 'bob');
    remember(harness, twitchBob);
    remember(harness, kickBob);
    expect(harness.runner.handle(broadcaster('!multichat permit kick:bob'))?.name).toBe('permit');
    expect(harness.runner.handle({ ...kickBob, id: 'kick-allowed', text: '!multichat ping' })?.name).toBe('ping');
    expect(harness.runner.handle({ ...twitchBob, id: 'twitch-denied', text: '!multichat ping' })).toBeNull();
    expect(harness.runner.handle(broadcaster('!multichat permit twitch:bob'))?.name).toBe('permit');
    expect(harness.runner.handle(moderator('!multichat permitted'))?.name).toBe('permitted');
    expect(lastNotice(harness)).toContain('twitch:@bob');
    expect(lastNotice(harness)).toContain('kick:@bob');
  });

  it('rejects missing, unknown-platform, excessive, control-character, and ambiguous targets', () => {
    const harness = createHarness();
    remember(harness, viewer('twitch', 'one', 'first', 'hello', 'Duplicate'));
    remember(harness, viewer('twitch', 'two', 'second', 'hello', 'Duplicate'));
    const attempts = [
      '!multichat permit',
      '!multichat permit discord:bob',
      `!multichat permit ${'a'.repeat(101)}`,
      '!multichat permit bad\u0007name',
      '!multichat permit Duplicate',
    ];
    for (const text of attempts) {
      expect(harness.runner.handle(broadcaster(text))?.name).toBe('permit');
      expect(lastNotice(harness)).toBe('Permit failed: target must have spoken recently and match exactly.');
    }
  });

  it('fails closed when the target or permitted command sender lacks a stable id', () => {
    const harness = createHarness();
    const noId = viewer('tiktok', '', 'alice');
    remember(harness, noId);
    expect(harness.runner.handle(broadcaster('!multichat permit tiktok:alice'))?.name).toBe('permit');
    expect(lastNotice(harness)).toContain('Permit failed:');
    expect(harness.runner.handle({ ...noId, id: 'no-id-command', text: '!multichat ping' })).toBeNull();
  });
});

describe('permitted command policy', () => {
  it('allows only the presentation-control command set after alias normalization', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'user-1', 'alice');
    grant(harness, alice);
    const commands = [
      ['ping', 'ping'],
      ['cls', 'clear'],
      ['freeze', 'pause'],
      ['play', 'resume'],
      ['tp', 'togglepause'],
      ['hide', 'hide'],
      ['show', 'show'],
      ['kickoff', 'kickoff'],
      ['kickon', 'kickon'],
      ['twitchoff', 'twitchoff'],
      ['twitchon', 'twitchon'],
      ['youtubeoff', 'youtubeoff'],
      ['youtubeon', 'youtubeon'],
      ['tiktokoff', 'tiktokoff'],
      ['tiktokon', 'tiktokon'],
      ['sharedoff', 'sharedoff'],
      ['sharedon', 'sharedon'],
      ['animation auto', 'animation'],
      ['events follows on', 'events'],
    ] as const;
    for (const [text, canonical] of commands) {
      const command = { ...alice, id: `allowed-${text}`, text: `!multichat ${text}` };
      expect(harness.runner.handle(command)?.name, text).toBe(canonical);
    }
    expect(harness.log.clears).toBe(1);
    expect(harness.log.pauseStates).toEqual([true, false]);
    expect(harness.log.pauseToggles).toBe(1);
  });

  it('denies sensitive and permission-management commands without side effects', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'user-1', 'alice');
    grant(harness, alice);
    const commands = [
      'reload', 'stop', 'counterbgon', 'counterbgoff', 'refresh', 'refresh emotes',
      'img https://example.com/a.png', 'yt rickroll', 'tts hello',
      'permit alice', 'grant alice', 'allow alice',
      'unpermit alice', 'revoke alice', 'deny alice',
      'permitted', 'perms', 'permissions',
    ];
    for (const text of commands) {
      expect(harness.runner.handle({ ...alice, id: `denied-${text}`, text: `!multichat ${text}` }), text).toBeNull();
    }
    expect(harness.log.reloads).toBe(0);
    expect(harness.log.removeAll).toBe(0);
    expect(harness.log.counterBackground).toEqual([]);
    expect(harness.log.refreshes).toBe(0);
    expect(harness.log.mounted).toBe(0);
    expect(harness.log.spoken).toEqual([]);
    expect(harness.log.stops).toBe(0);
  });
});

describe('bounded runtime permission lifecycle', () => {
  it('rejects permit 26 without evicting the existing 25 and truncates listing safely', () => {
    const harness = createHarness();
    const targets = Array.from({ length: MULTICHAT_PERMIT_LIMIT + 1 }, (_, index) =>
      viewer('twitch', `user-id-${index}`, `user${index}`));
    for (const target of targets) remember(harness, target);
    for (let index = 0; index < MULTICHAT_PERMIT_LIMIT; index += 1) {
      expect(harness.runner.handle(broadcaster(`!multichat permit user${index}`))?.name).toBe('permit');
    }
    expect(harness.runner.handle(broadcaster(`!multichat permit user${MULTICHAT_PERMIT_LIMIT}`))?.name).toBe('permit');
    expect(lastNotice(harness)).toBe(`Permit failed: maximum of ${MULTICHAT_PERMIT_LIMIT} permits reached.`);

    expect(harness.runner.handle({ ...targets[0], id: 'first-still-allowed', text: '!multichat ping' })?.name).toBe('ping');
    expect(harness.runner.handle({ ...targets[MULTICHAT_PERMIT_LIMIT], id: 'twenty-six-denied', text: '!multichat ping' })).toBeNull();
    expect(harness.runner.handle(moderator('!multichat permitted'))?.name).toBe('permitted');
    expect(lastNotice(harness)).toContain('... and 15 more');
    expect(lastNotice(harness)).not.toContain('user-id-');
  });

  it('bounds the recent identity cache at 200 entries', () => {
    const harness = createHarness();
    const targets = Array.from({ length: MULTICHAT_RECENT_IDENTITY_LIMIT + 1 }, (_, index) =>
      viewer('twitch', `recent-id-${index}`, `recent${index}`));
    for (const target of targets) remember(harness, target);

    expect(harness.runner.handle(broadcaster('!multichat permit recent0'))?.name).toBe('permit');
    expect(lastNotice(harness)).toContain('Permit failed:');
    expect(harness.runner.handle(broadcaster(`!multichat permit recent${MULTICHAT_RECENT_IDENTITY_LIMIT}`))?.name).toBe('permit');
    expect(lastNotice(harness)).toBe(`Permitted: twitch:@recent${MULTICHAT_RECENT_IDENTITY_LIMIT}`);
  });

  it('expires stale recent identities after approximately fifteen minutes', () => {
    const harness = createHarness();
    remember(harness, viewer('twitch', 'stale-id', 'staleuser'));
    harness.advance(MULTICHAT_RECENT_IDENTITY_TTL_MS + 1);
    expect(harness.runner.handle(broadcaster('!multichat permit staleuser'))?.name).toBe('permit');
    expect(lastNotice(harness)).toContain('Permit failed:');
  });

  it('keeps authorization on immutable id through rename and updates the public label', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'stable-id', 'alice');
    grant(harness, alice);
    const renamed = viewer('twitch', 'stable-id', 'alicia', 'ordinary rename', 'Alicia Display');
    remember(harness, renamed);
    expect(harness.runner.handle({ ...renamed, id: 'renamed-ping', text: '!multichat ping' })?.name).toBe('ping');
    expect(harness.runner.handle(moderator('!multichat permitted'))?.name).toBe('permitted');
    expect(lastNotice(harness)).toBe('Permitted: twitch:@alicia');
  });

  it('revokes by a uniquely stored label after the recent identity expires', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'stable-id', 'alice');
    grant(harness, alice);
    harness.advance(MULTICHAT_RECENT_IDENTITY_TTL_MS + 1);
    expect(harness.runner.handle(broadcaster('!multichat unpermit alice'))?.name).toBe('unpermit');
    expect(lastNotice(harness)).toBe('Revoked: twitch:@alice');
  });

  it('survives reconnect-like traffic on one runner but resets in a new runner', () => {
    const first = createHarness();
    const alice = viewer('twitch', 'stable-id', 'alice');
    grant(first, alice);
    remember(first, viewer('twitch', 'other-id', 'other', 'message after reconnect'));
    expect(first.runner.handle({ ...alice, id: 'after-reconnect', text: '!multichat ping' })?.name).toBe('ping');

    const reloaded = createMultichatCommandRunner(first.host);
    expect(reloaded.handle({ ...alice, id: 'after-reload', text: '!multichat ping' })).toBeNull();
  });

  it('deduplicates a repeated permit delivery', () => {
    const harness = createHarness();
    const alice = viewer('twitch', 'stable-id', 'alice');
    remember(harness, alice);
    const command = broadcaster('!multichat permit alice', 'duplicate-permit');
    expect(harness.runner.handle(command)?.name).toBe('permit');
    const noticeCount = harness.log.floats.length;
    expect(harness.runner.handle(command)).toBeNull();
    expect(harness.log.floats).toHaveLength(noticeCount);
  });
});
