import { describe, expect, it } from 'vitest';
import {
  createMultichatCommandRunner,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import type { UnifiedMessage } from '@/lib/types';

type Role = 'broadcaster' | 'moderator' | 'viewer';

function createHarness() {
  const mounted: Array<{ slot: number; element: HTMLElement; timeoutMs: number }> = [];
  const removed: number[] = [];
  const created: string[] = [];
  const host: CommandHost = {
    channels: { twitch: 'streamer' },
    showFloat: () => {},
    removeFloat: (slot) => removed.push(slot),
    removeAllFloats: () => {},
    clearChatMessages: () => {},
    setChatPresentationPaused: () => {},
    toggleChatPresentationPaused: () => {},
    mountFloat: (slot, element, timeoutMs) => mounted.push({ slot, element, timeoutMs }),
    createElement: (tag) => {
      created.push(tag);
      return document.createElement(tag);
    },
    setChatVisible: () => {},
    setPlatformChatVisible: () => {},
    setSharedChatVisible: () => {},
    setCounterBackground: () => {},
    reload: () => {},
    refreshEmotes: async () => {},
    findEmoteUrl: (name) => name === 'KEKW'
      ? 'https://cdn.7tv.app/emote/abc/4x.webp'
      : null,
    speak: () => {},
    stopSpeaking: () => {},
    readReloadStamp: () => null,
    writeReloadStamp: () => {},
    now: () => 1_000,
  };
  return {
    mounted,
    removed,
    created,
    runner: createMultichatCommandRunner(host),
  };
}

let sequence = 0;

function command(
  text: string,
  role: Role,
  overrides: Partial<UnifiedMessage> = {},
): UnifiedMessage {
  sequence += 1;
  return {
    platform: 'twitch',
    id: `media-${sequence}`,
    senderId: `${role}-id`,
    senderUsername: role === 'broadcaster' ? 'streamer' : `${role}-login`,
    username: role === 'broadcaster' ? 'Streamer' : role,
    color: '',
    badges: role === 'broadcaster'
      ? [{ type: 'broadcaster' }]
      : role === 'moderator'
        ? [{ type: 'moderator' }]
        : [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
    ...overrides,
  };
}

describe('MultiChat remote image command security', () => {
  it.each(['broadcaster', 'moderator'] as const)(
    'keeps public signed HTTPS images available to a native %s',
    (role) => {
      const harness = createHarness();
      const url = 'https://media.cdn.example.com/alert.gif?Expires=2000000000&Signature=a%2Fb';
      expect(harness.runner.handle(command(
        `!multichat img ${url} -t 7 -o 0.4`,
        role,
      ))?.name).toBe('img');
      expect(harness.mounted).toHaveLength(1);
      expect(harness.mounted[0].slot).toBe(4);
      expect(harness.mounted[0].timeoutMs).toBe(7_000);
      const image = harness.mounted[0].element.querySelector('img')!;
      expect(image.src).toBe(url);
      expect(image.style.opacity).toBe('0.4');
    },
  );

  it('keeps the legacy trigger, emote lookup, and clear behavior unchanged', () => {
    const harness = createHarness();
    expect(harness.runner.handle(command('!kickchat img KEKW', 'moderator'))?.name).toBe('img');
    expect(harness.mounted[0].element.querySelector('img')!.src)
      .toBe('https://cdn.7tv.app/emote/abc/4x.webp');
    expect(harness.runner.handle(command('!multichat img clear', 'moderator'))?.name).toBe('img');
    expect(harness.removed).toEqual([4]);
  });

  it('rejects ordinary viewers and display-name broadcaster spoofs', () => {
    const harness = createHarness();
    const url = 'https://images.example.com/alert.png';
    expect(harness.runner.handle(command(`!multichat img ${url}`, 'viewer'))).toBeNull();
    expect(harness.runner.handle(command(`!multichat img ${url}`, 'viewer', {
      id: 'display-spoof',
      senderUsername: 'attacker-login',
      username: 'streamer',
    }))).toBeNull();
    expect(harness.mounted).toEqual([]);
  });

  it('retains the canonical broadcaster fallback without trusting display names', () => {
    const harness = createHarness();
    const url = 'https://images.example.com/alert.png';
    expect(harness.runner.handle(command(`!multichat img ${url}`, 'viewer', {
      id: 'canonical-owner',
      senderId: 'canonical-owner-id',
      senderUsername: 'streamer',
      username: 'Unrelated Display Name',
    }))?.name).toBe('img');
    expect(harness.mounted).toHaveLength(1);
  });

  it.each([
    'http://images.example.com/alert.png',
    'https://localhost/alert.png',
    'https://127.0.0.1/alert.png',
    'https://[::1]/alert.png',
    'https://user:pass@images.example.com/alert.png',
  ])('creates no element or request-capable src for a rejected URL: %s', (url) => {
    const harness = createHarness();
    expect(harness.runner.handle(command(`!multichat img ${url}`, 'moderator'))?.name).toBe('img');
    expect(harness.created).toEqual([]);
    expect(harness.mounted).toEqual([]);
  });

  it('does not affect unrelated commands', () => {
    const harness = createHarness();
    expect(harness.runner.handle(command('!multichat ping', 'moderator'))?.name).toBe('ping');
    expect(harness.created).toEqual([]);
    expect(harness.mounted).toEqual([]);
  });
});
