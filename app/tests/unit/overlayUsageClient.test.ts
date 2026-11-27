import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_USAGE_ENDPOINT,
  OVERLAY_USAGE_INSTANCE_STORAGE_KEY,
  createOverlayUsagePageContext,
  createOverlayUsageReporter,
  reportCounterOverlayUsage,
  type OverlayUsageAction,
  type OverlayUsagePageContext,
} from '@/lib/overlayUsage';

const EVENT_ONE = '11111111-1111-4111-8111-111111111111';
const EVENT_TWO = '22222222-2222-4222-8222-222222222222';
const INSTANCE = 'aabbccdd-aabb-4cdd-8abb-aabbccddeeff';

function pageContext(
  eventId = EVENT_ONE,
  action: OverlayUsageAction = 'opened',
): OverlayUsagePageContext {
  return { eventId, action, instanceId: 'aabbccdd', sent: false };
}

function postedBody(fetchUsage: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(String((fetchUsage.mock.calls[call][1] as RequestInit).body));
}

describe('overlay usage client reporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('waits for provider-confirmed canonical MultiChat identities and reports one page event', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const reporter = createOverlayUsageReporter(
      ['twitch', 'kick', 'youtube', 'tiktok'],
      { fetch: fetchUsage, pageContext: pageContext(), resolutionWindowMs: 100 },
    );

    reporter.resolved('twitch', '@Some_Channel');
    reporter.resolved('kick', 'Kick-Streamer');
    reporter.resolved('youtube', '@Agent00');
    expect(fetchUsage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect(fetchUsage).toHaveBeenCalledWith(OVERLAY_USAGE_ENDPOINT, expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
    }));
    expect(postedBody(fetchUsage)).toEqual({
      eventId: EVENT_ONE,
      overlay: 'multichat',
      channels: [
        { platform: 'twitch', channel: 'Some_Channel' },
        { platform: 'kick', channel: 'Kick-Streamer' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
      action: 'opened',
      instanceId: 'aabbccdd',
    });
    expect(String((fetchUsage.mock.calls[0][1] as RequestInit).body))
      .not.toMatch(/token|oauth|cookie|message|settings|url/i);
    reporter.stop();
  });

  it('dedupes StrictMode/remount reporters sharing one page event', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const context = pageContext();
    const first = createOverlayUsageReporter(['twitch'], { fetch: fetchUsage, pageContext: context });
    first.resolved('twitch', 'gxufy');
    first.stop();

    const remount = createOverlayUsageReporter(['twitch'], { fetch: fetchUsage, pageContext: context });
    remount.resolved('twitch', 'GXUFY');
    remount.stop();

    expect(fetchUsage).toHaveBeenCalledTimes(1);
  });

  it('delivers the same channels again for a new refresh event id', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    for (const context of [pageContext(EVENT_ONE, 'opened'), pageContext(EVENT_TWO, 'refreshed')]) {
      const reporter = createOverlayUsageReporter(['twitch'], { fetch: fetchUsage, pageContext: context });
      reporter.resolved('twitch', 'gxufy');
      reporter.stop();
    }

    expect(fetchUsage).toHaveBeenCalledTimes(2);
    expect(postedBody(fetchUsage, 0).action).toBe('opened');
    expect(postedBody(fetchUsage, 1).action).toBe('refreshed');
  });

  it('creates reload-aware page contexts and persists only an anonymous random instance UUID', () => {
    const randomUuid = vi.fn()
      .mockReturnValueOnce(EVENT_ONE)
      .mockReturnValueOnce(INSTANCE)
      .mockReturnValueOnce(EVENT_TWO);

    const first = createOverlayUsagePageContext({
      storage: window.localStorage,
      randomUuid,
      navigationType: () => 'reload',
    });
    const second = createOverlayUsagePageContext({
      storage: window.localStorage,
      randomUuid,
      navigationType: () => 'navigate',
    });

    expect(first).toEqual({
      eventId: EVENT_ONE,
      action: 'refreshed',
      instanceId: 'aabbccdd',
      sent: false,
    });
    expect(second).toEqual({
      eventId: EVENT_TWO,
      action: 'opened',
      instanceId: 'aabbccdd',
      sent: false,
    });
    expect(window.localStorage.getItem(OVERLAY_USAGE_INSTANCE_STORAGE_KEY)).toBe(INSTANCE);
  });

  it('reports a counter once per page and never again for poll-like repeated calls', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const context = pageContext();
    const channels = { twitch: '@GXUFY', youtube: '@Agent00' };

    reportCounterOverlayUsage(channels, true, { fetch: fetchUsage, pageContext: context });
    reportCounterOverlayUsage(channels, true, { fetch: fetchUsage, pageContext: context });
    reportCounterOverlayUsage(channels, true, { fetch: fetchUsage, pageContext: context });

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect(postedBody(fetchUsage)).toEqual({
      eventId: EVENT_ONE,
      overlay: 'counter',
      channels: [
        { platform: 'twitch', channel: 'GXUFY' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
      combined: true,
      action: 'opened',
      instanceId: 'aabbccdd',
    });
  });

  it('allows a refreshed counter page with the same channels to report again', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    reportCounterOverlayUsage(
      { twitch: 'gxufy' },
      false,
      { fetch: fetchUsage, pageContext: pageContext(EVENT_ONE, 'opened') },
    );
    reportCounterOverlayUsage(
      { twitch: 'gxufy' },
      false,
      { fetch: fetchUsage, pageContext: pageContext(EVENT_TWO, 'refreshed') },
    );
    expect(fetchUsage).toHaveBeenCalledTimes(2);
    expect(postedBody(fetchUsage, 1)).toMatchObject({ action: 'refreshed', combined: false });
  });

  it('ignores invalid or unconfigured channels and sends nothing with no success', () => {
    const fetchUsage = vi.fn().mockResolvedValue({ ok: true });
    const reporter = createOverlayUsageReporter(['twitch'], {
      fetch: fetchUsage,
      pageContext: pageContext(),
      resolutionWindowMs: 50,
    });

    reporter.resolved('kick', 'not-configured');
    reporter.resolved('twitch', 'contains spaces');
    vi.advanceTimersByTime(50);
    expect(fetchUsage).not.toHaveBeenCalled();
    reporter.stop();
    reportCounterOverlayUsage({}, true, { fetch: fetchUsage, pageContext: pageContext() });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it('keeps storage and synchronous/asynchronous network failures non-fatal', async () => {
    const throwingStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(() => createOverlayUsagePageContext({
      storage: throwingStorage,
      randomUuid: () => EVENT_ONE,
      navigationType: () => 'back_forward',
    })).not.toThrow();

    const rejected = createOverlayUsageReporter(['twitch'], {
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      pageContext: pageContext(),
    });
    expect(() => rejected.resolved('twitch', 'gxufy')).not.toThrow();
    await Promise.resolve();
    rejected.stop();

    const synchronous = createOverlayUsageReporter(['twitch'], {
      fetch: () => { throw new Error('offline'); },
      pageContext: pageContext(EVENT_TWO),
    });
    expect(() => synchronous.resolved('twitch', 'gxufy')).not.toThrow();
    synchronous.stop();
  });
});
