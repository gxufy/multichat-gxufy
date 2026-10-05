import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMultichatCommandRunner,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import {
  getRuntimeAnimationMode,
  resetRuntimeAnimationState,
} from '@/lib/multichatAnimationRuntime';
import type { UnifiedMessage } from '@/lib/types';

function moderator(text: string, id: string): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId: 'mod-1',
    username: 'somemod',
    color: '#fff',
    badges: [{ type: 'moderator' }],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function harness() {
  const notices: string[] = [];
  const host: CommandHost = {
    channels: { twitch: 'streamer' },
    showFloat: (_slot, message) => notices.push(message),
    removeFloat: vi.fn(),
    removeAllFloats: vi.fn(),
    clearChatMessages: vi.fn(),
    setChatPresentationPaused: vi.fn(),
    toggleChatPresentationPaused: vi.fn(),
    mountFloat: vi.fn(),
    createElement: (tag) => document.createElement(tag),
    setChatVisible: vi.fn(),
    setPlatformChatVisible: vi.fn(),
    setSharedChatVisible: vi.fn(),
    setCounterBackground: vi.fn(),
    reload: vi.fn(),
    refreshEmotes: vi.fn(async () => {}),
    findEmoteUrl: vi.fn(() => null),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    readReloadStamp: vi.fn(() => null),
    writeReloadStamp: vi.fn(),
    now: vi.fn(() => 1_000),
  };
  return { notices, runner: createMultichatCommandRunner(host) };
}

beforeEach(() => resetRuntimeAnimationState());
afterEach(() => resetRuntimeAnimationState());

describe('!multichat animation', () => {
  it.each([
    ['off', 'off', 'Chat animations OFF'],
    ['on', 'on', 'Chat animations ON'],
    ['auto', 'auto', 'Chat animations AUTO — bypassing heavy bursts'],
  ] as const)('sets runtime animation mode to %s', (argument, expected, notice) => {
    const { notices, runner } = harness();
    const handled = runner.handle(moderator(`!multichat animation ${argument}`, `animation-${argument}`));

    expect(handled?.name).toBe('animation');
    expect(getRuntimeAnimationMode()).toBe(expected);
    expect(notices.at(-1)).toBe(notice);
  });

  it('shows usage for a bare animation command without changing the mode', () => {
    setModeOff();
    const { notices, runner } = harness();
    expect(runner.handle(moderator('!multichat animation', 'bare'))?.name).toBe('animation');
    expect(getRuntimeAnimationMode()).toBe('off');
    expect(notices.at(-1)).toBe('Usage: !multichat animation <on|off|auto>');
  });

  it('rejects invalid animation modes without leaving adaptive default mode', () => {
    const { notices, runner } = harness();
    expect(runner.handle(moderator('!multichat animation sometimes', 'invalid'))).toBeNull();
    expect(getRuntimeAnimationMode()).toBe('auto');
    expect(notices).toEqual([]);
  });
});

function setModeOff() {
  const { runner } = harness();
  runner.handle(moderator('!multichat animation off', 'setup-off'));
}
