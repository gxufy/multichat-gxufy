import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_USAGE_COOLDOWN_MS,
  OVERLAY_USAGE_ENDPOINT,
  createOverlayUsageReporter,
} from '@/lib/overlayUsage';

describe('overlay usage client reporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('waits for successful resolutions and sends only the resolved channel fields', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const reporter = createOverlayUsageReporter(
      ['twitch', 'kick', 'youtube', 'tiktok'],
      { fetch: fetchUsage, storage: window.sessionStorage, resolutionWindowMs: 100 },
    );

    reporter.resolved('twitch', '@Some_Channel');
    reporter.resolved('kick', 'Kick-Streamer');
    reporter.resolved('youtube', '@Agent00');
    expect(fetchUsage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect(fetchUsage).toHaveBeenCalledWith(OVERLAY_USAGE_ENDPOINT, expect.objectContaining({
      method: 'POST',
      keepalive: true,
    }));
    const request = fetchUsage.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      overlay: 'multichat',
      channels: [
        { platform: 'twitch', channel: 'Some_Channel' },
        { platform: 'kick', channel: 'Kick-Streamer' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
    });
    expect(String(request.body)).not.toMatch(/token|oauth|cookie|message|settings|url/i);
    reporter.stop();
  });

  it('reports a complete set once and dedupes it across a same-session remount', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const create = () => createOverlayUsageReporter(
      ['twitch', 'tiktok'],
      { fetch: fetchUsage, storage: window.sessionStorage, now: () => 50_000 },
    );
    const first = create();
    first.resolved('twitch', 'gxufy');
    first.resolved('tiktok', '@tiktok');
    first.resolved('tiktok', 'tiktok');
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    first.stop();

    const remount = create();
    remount.resolved('twitch', 'GXUFY');
    remount.resolved('tiktok', 'tiktok');
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    remount.stop();
  });

  it('allows a changed channel set and the original set after its cooldown', () => {
    let now = 100_000;
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const reporter = createOverlayUsageReporter(['twitch'], {
      fetch: fetchUsage,
      storage: window.sessionStorage,
      now: () => now,
    });

    reporter.resolved('twitch', 'one');
    reporter.resolved('twitch', 'two');
    reporter.resolved('twitch', 'one');
    expect(fetchUsage).toHaveBeenCalledTimes(2);

    now += OVERLAY_USAGE_COOLDOWN_MS;
    reporter.resolved('twitch', 'one');
    expect(fetchUsage).toHaveBeenCalledTimes(3);
    reporter.stop();
  });

  it('ignores invalid or unconfigured platforms and sends nothing with no success', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const reporter = createOverlayUsageReporter(['twitch'], {
      fetch: fetchUsage,
      storage: window.sessionStorage,
      resolutionWindowMs: 50,
    });

    reporter.resolved('kick', 'not-configured');
    reporter.resolved('twitch', 'contains spaces');
    vi.advanceTimersByTime(50);
    expect(fetchUsage).not.toHaveBeenCalled();
    reporter.stop();
  });

  it('keeps synchronous and asynchronous network failures non-fatal', async () => {
    const rejected = createOverlayUsageReporter(['twitch'], {
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      storage: null,
    });
    expect(() => rejected.resolved('twitch', 'gxufy')).not.toThrow();
    await Promise.resolve();
    rejected.stop();

    const synchronous = createOverlayUsageReporter(['twitch'], {
      fetch: () => { throw new Error('offline'); },
      storage: null,
    });
    expect(() => synchronous.resolved('twitch', 'gxufy')).not.toThrow();
    synchronous.stop();
  });

  it('fails safely with malformed or unavailable session storage', () => {
    window.sessionStorage.setItem('gxufy:multichat:usage:v1', '{bad');
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const throwingStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const reporter = createOverlayUsageReporter(['twitch'], {
      fetch: fetchUsage,
      storage: throwingStorage,
    });
    expect(() => reporter.resolved('twitch', 'gxufy')).not.toThrow();
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    reporter.stop();
  });
});
