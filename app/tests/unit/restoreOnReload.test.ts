import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import type { ParsedMessage } from '@/lib/kick';
import { MULTICHAT_GENERATOR_DEFAULTS, MultichatQuerySchema, buildMultichatQuery } from '@/lib/multichatConfig';
import { loadRestoredMultichatMessages, multichatMessageStorageKey, saveRestoredMultichatMessages } from '@/lib/multichatMessagePersistence';
import { resetRuntimeAnimationState } from '@/lib/multichatAnimationRuntime';
import type { UnifiedMessage } from '@/lib/types';

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
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetRuntimeAnimationState();
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
