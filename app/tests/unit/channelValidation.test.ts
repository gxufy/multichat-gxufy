import { describe, expect, it } from 'vitest';
import { normalizeChatChannel, validChatChannel } from '@/lib/channelValidation';

describe('chat channel validation', () => {
  it('normalizes provider prefixes without changing valid names', () => {
    expect(normalizeChatChannel('kick', '  @kick_name-1  ')).toBe('kick_name-1');
    expect(normalizeChatChannel('twitch', ' #Some_User ')).toBe('Some_User');
    expect(normalizeChatChannel('youtube', '@name.with-dash')).toBe('name.with-dash');
    expect(normalizeChatChannel('tiktok', '@name.with_dot')).toBe('name.with_dot');
  });

  it('rejects whitespace, control characters, URL syntax, and provider-invalid punctuation', () => {
    for (const [platform, value] of [
      ['kick', 'name/other'],
      ['twitch', 'bad-name'],
      ['youtube', 'bad/name'],
      ['tiktok', 'bad-name'],
      ['twitch', 'name\r\nJOIN #other'],
      ['youtube', '   '],
    ] as const) {
      expect(normalizeChatChannel(platform, value)).toBe('');
      expect(validChatChannel(platform, value)).toBe(false);
    }
  });

  it('preserves the provider-facing length contracts', () => {
    expect(validChatChannel('kick', 'k'.repeat(80))).toBe(true);
    expect(validChatChannel('kick', 'k'.repeat(81))).toBe(false);
    expect(validChatChannel('twitch', 't'.repeat(25))).toBe(true);
    expect(validChatChannel('twitch', 't'.repeat(26))).toBe(false);
    expect(validChatChannel('youtube', 'y'.repeat(50))).toBe(true);
    expect(validChatChannel('tiktok', 'z'.repeat(50))).toBe(true);
  });
});
