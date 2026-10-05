import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMultichatCommandRunner,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import {
  MULTICHAT_EVENT_CATEGORIES,
  resetRuntimeEventVisibility,
  runtimeEventFeatureVisible,
} from '@/lib/multichatEventRuntime';
import { buildMessageFilter } from '@/lib/multichatMessageModel';
import type { EventCategory, UnifiedMessage } from '@/lib/types';

const FILTER_CONFIG = {
  botNames: '',
  userBL: '',
  prefixBL: '',
  showSystemMsgs: true,
  showFirstMessages: true,
  showRedeems: true,
};

function commandMessage(text: string, id = text): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId: 'mod-1',
    username: 'somemod',
    color: '',
    badges: [{ type: 'moderator' }],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function systemMessage(category: EventCategory): UnifiedMessage {
  return {
    platform: 'twitch',
    id: `event-${category}`,
    senderId: 'event',
    username: 'Twitch',
    color: '',
    badges: [],
    text: category,
    emotes: [],
    timestamp: 1,
    kind: 'system',
    category,
  };
}

function chatFeature(kind: 'first' | 'redeem'): UnifiedMessage {
  return {
    platform: 'twitch',
    id: kind,
    senderId: 'viewer',
    username: 'viewer',
    color: '',
    badges: [],
    text: 'hello',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
    ...(kind === 'first' ? { firstMessage: true } : { redeem: 'reward' }),
  };
}

function createRunner() {
  const notices: string[] = [];
  const host: CommandHost = {
    channels: { twitch: 'streamer' },
    showFloat: (_slot, message) => notices.push(message),
    removeFloat: () => {},
    removeAllFloats: () => {},
    clearChatMessages: () => {},
    setChatPresentationPaused: () => {},
    toggleChatPresentationPaused: () => {},
    mountFloat: () => {},
    createElement: (tag) => document.createElement(tag),
    setChatVisible: () => {},
    setPlatformChatVisible: () => {},
    setSharedChatVisible: () => {},
    setCounterBackground: () => {},
    reload: () => {},
    refreshEmotes: async () => {},
    findEmoteUrl: () => null,
    speak: () => {},
    stopSpeaking: () => {},
    readReloadStamp: () => null,
    writeReloadStamp: () => {},
    now: () => 1,
  };
  return { runner: createMultichatCommandRunner(host), notices };
}

beforeEach(() => resetRuntimeEventVisibility());

describe('runtime event commands', () => {
  it('turns every notification feature off and back on without rebuilding the filter', () => {
    const { runner } = createRunner();
    const filter = buildMessageFilter(FILTER_CONFIG);

    expect(MULTICHAT_EVENT_CATEGORIES.every((category) => filter(systemMessage(category)))).toBe(true);
    expect(filter(chatFeature('first'))).toBe(true);
    expect(filter(chatFeature('redeem'))).toBe(true);

    expect(runner.handle(commandMessage('!multichat events off', 'off'))?.name).toBe('events');
    for (const category of MULTICHAT_EVENT_CATEGORIES) {
      expect(runtimeEventFeatureVisible(category), category).toBe(false);
      expect(filter(systemMessage(category)), category).toBe(false);
    }
    expect(filter(chatFeature('first'))).toBe(false);
    expect(filter(chatFeature('redeem'))).toBe(false);

    expect(runner.handle(commandMessage('!multichat events on', 'on'))?.name).toBe('events');
    for (const category of MULTICHAT_EVENT_CATEGORIES) {
      expect(runtimeEventFeatureVisible(category), category).toBe(true);
      expect(filter(systemMessage(category)), category).toBe(true);
    }
    expect(filter(chatFeature('first'))).toBe(true);
    expect(filter(chatFeature('redeem'))).toBe(true);
  });

  it('controls individual categories and treats watchstreaks as milestones', () => {
    const { runner } = createRunner();
    const filter = buildMessageFilter(FILTER_CONFIG);

    runner.handle(commandMessage('!multichat events raids off', 'raid-off'));
    expect(filter(systemMessage('raid'))).toBe(false);
    expect(filter(systemMessage('subscription'))).toBe(true);

    runner.handle(commandMessage('!multichat events subs off', 'sub-off'));
    expect(filter(systemMessage('subscription'))).toBe(false);

    runner.handle(commandMessage('!multichat events watchstreaks off', 'streak-off'));
    expect(runtimeEventFeatureVisible('milestone')).toBe(false);
    expect(filter(systemMessage('milestone'))).toBe(false);

    runner.handle(commandMessage('!multichat events milestones on', 'milestone-on'));
    expect(runtimeEventFeatureVisible('milestone')).toBe(true);
    expect(filter(systemMessage('milestone'))).toBe(true);
  });

  it('controls first-message and redeem gates independently', () => {
    const { runner } = createRunner();
    const filter = buildMessageFilter(FILTER_CONFIG);

    runner.handle(commandMessage('!multichat events firstmessages off', 'first'));
    runner.handle(commandMessage('!multichat events redeems off', 'redeem'));

    expect(filter(chatFeature('first'))).toBe(false);
    expect(filter(chatFeature('redeem'))).toBe(false);
    expect(filter(systemMessage('gift'))).toBe(true);
  });

  it('ignores malformed event arguments without changing visibility', () => {
    const { runner } = createRunner();
    expect(runner.handle(commandMessage('!multichat events subs maybe', 'bad'))).toBeNull();
    expect(runtimeEventFeatureVisible('subscription')).toBe(true);
    expect(runner.handle(commandMessage('!multichat events unknown off', 'unknown'))).toBeNull();
    expect(MULTICHAT_EVENT_CATEGORIES.every(runtimeEventFeatureVisible)).toBe(true);
  });

  it('shows usage for the bare events command and leaves state unchanged', () => {
    const { runner, notices } = createRunner();
    expect(runner.handle(commandMessage('!multichat events', 'usage'))?.name).toBe('events');
    expect(notices.at(-1)).toContain('events off');
    expect(MULTICHAT_EVENT_CATEGORIES.every(runtimeEventFeatureVisible)).toBe(true);
  });
});
