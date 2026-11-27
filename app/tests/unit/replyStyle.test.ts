import { describe, expect, it } from 'vitest';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_REPLY_STYLES,
  MultichatQuerySchema,
  buildMultichatQuery,
} from '@/lib/multichatConfig';

const channels = { kick: 'somechannel', twitch: '', youtube: '', tiktok: '' };

describe('replyStyle config', () => {
  it('accepts full, mention, and off while defaulting invalid or missing values to full', () => {
    expect(MULTICHAT_REPLY_STYLES).toEqual(['full', 'mention', 'off']);
    expect(MultichatQuerySchema.parse({}).replyStyle).toBe('full');
    expect(MultichatQuerySchema.parse({ replyStyle: 'invalid' }).replyStyle).toBe('full');
    expect(MultichatQuerySchema.parse({ replyStyle: 'mention' }).replyStyle).toBe('mention');
    expect(MultichatQuerySchema.parse({ replyStyle: 'off' }).replyStyle).toBe('off');
  });

  it('omits full and serializes mention and off explicitly', () => {
    const queryFor = (replyStyle: 'full' | 'mention' | 'off') => new URLSearchParams(
      buildMultichatQuery(channels, { ...MULTICHAT_GENERATOR_DEFAULTS, replyStyle }),
    );

    expect(queryFor('full').has('replyStyle')).toBe(false);
    expect(queryFor('mention').get('replyStyle')).toBe('mention');
    expect(queryFor('off').get('replyStyle')).toBe('off');
  });

  it('normalizes saved workspace values against the reply-style enum', () => {
    expect(normalizeMultichatStyle({ replyStyle: 'mention' }).replyStyle).toBe('mention');
    expect(normalizeMultichatStyle({ replyStyle: 'off' }).replyStyle).toBe('off');
    expect(normalizeMultichatStyle({ replyStyle: 'invalid' as never }).replyStyle).toBe('full');
  });
});
