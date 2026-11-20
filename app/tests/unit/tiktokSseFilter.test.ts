import { describe, expect, it } from 'vitest';
import { shouldSendTikTokSseEvent, tikTokSseSince } from '@/pages/api/tiktok/chat';

describe('TikTok SSE session cutoff', () => {
  it('parses a valid overlay-start timestamp and ignores invalid values', () => {
    expect(tikTokSseSince('10000')).toBe(10_000);
    expect(tikTokSseSince(['12000', '13000'])).toBe(12_000);
    expect(tikTokSseSince('bad')).toBeNull();
    expect(tikTokSseSince('0')).toBeNull();
    expect(tikTokSseSince(undefined)).toBeNull();
  });

  it('drops timestamped replay from before the overlay while preserving current and control events', () => {
    const since = 10_000;
    expect(shouldSendTikTokSseEvent({ type: 'chat', timestamp: 9_999 }, since)).toBe(false);
    expect(shouldSendTikTokSseEvent({ type: 'gift', timestamp: 10_000 }, since)).toBe(true);
    expect(shouldSendTikTokSseEvent({ type: 'chat', timestamp: 10_001 }, since)).toBe(true);
    expect(shouldSendTikTokSseEvent({ type: 'status', status: 'connected' }, since)).toBe(true);
    expect(shouldSendTikTokSseEvent({ type: 'delete', id: 'legacy-without-timestamp' }, since)).toBe(true);
  });

  it('uses the same session boundary for buffered moderation tombstones', () => {
    const since = 10_000;
    expect(shouldSendTikTokSseEvent({ type: 'delete', id: 'old', timestamp: 9_999 }, since)).toBe(false);
    expect(shouldSendTikTokSseEvent({ type: 'delete', id: 'current', timestamp: 10_000 }, since)).toBe(true);
  });

  it('preserves legacy subscribers that do not provide a since timestamp', () => {
    expect(shouldSendTikTokSseEvent({ type: 'chat', timestamp: 1 }, null)).toBe(true);
  });
});
