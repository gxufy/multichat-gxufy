/* Overlay lifecycle: one connector per configured platform, complete teardown,
 * and no native Twitch pin poller now that pin support is retired.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MultichatPage from '@/pages/multichat';

const replace = vi.fn();
let query: Record<string, string | string[]> = {};

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query, replace }),
}));
vi.mock('../../src/components/overlay/ChatOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="chat-overlay" />,
  FONT_FAMILIES: {},
}));
vi.mock('../../src/components/classic/ClassicGenerator', () => ({
  __esModule: true,
  default: () => <div data-testid="classic-generator" />,
}));

type Started = { platform: string; starts: number; stops: number };
const created: Started[] = [];
function connectorStub(platform: string) {
  const record: Started = { platform, starts: 0, stops: 0 };
  created.push(record);
  return {
    start() { record.starts += 1; },
    stop() { record.stops += 1; },
  };
}

vi.mock('../../src/lib/connectors/kick', () => ({
  createKickConnector: () => connectorStub('kick'),
}));
vi.mock('../../src/lib/connectors/twitch', () => ({
  createTwitchConnector: () => connectorStub('twitch'),
}));
vi.mock('../../src/lib/connectors/youtube', () => ({
  createYouTubeConnector: () => connectorStub('youtube'),
}));
vi.mock('../../src/lib/connectors/tiktok', () => ({
  createTikTokConnector: () => connectorStub('tiktok'),
}));

const cosmetics = { stops: 0 };
vi.mock('../../src/lib/cosmetics', () => ({
  createCosmeticsFetcher: () => ({
    want: () => undefined,
    stop: () => { cosmetics.stops += 1; },
  }),
}));

const pollerStops = vi.fn();
const startPoller = vi.fn(() => pollerStops);
vi.mock('../../src/lib/twitchPinPoller', () => ({
  startTwitchPinPoller: (...args: unknown[]) => startPoller(...(args as [])),
}));

const TEST_ID = '123e4567-e89b-12d3-a456-426614174000';
const forPlatform = (platform: string) => created.filter((c) => c.platform === platform);

beforeEach(() => {
  created.length = 0;
  cosmetics.stops = 0;
  replace.mockClear();
  startPoller.mockClear();
  pollerStops.mockClear();
  query = {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.useRealTimers();
});

describe('one connector per configured platform', () => {
  it('starts exactly the platforms in the URL', () => {
    query = { kick: 'somechannel', twitch: 'other' };
    render(<MultichatPage />);
    expect(forPlatform('kick')).toHaveLength(1);
    expect(forPlatform('twitch')).toHaveLength(1);
    expect(forPlatform('youtube')).toHaveLength(0);
    expect(forPlatform('tiktok')).toHaveLength(0);
    expect(created.every((c) => c.starts === 1)).toBe(true);
  });

  it.each(['kick', 'twitch', 'youtube', 'tiktok'] as const)(
    'starts one %s connector and no others',
    (platform) => {
      query = { [platform]: 'somechannel' };
      render(<MultichatPage />);
      expect(created.map((c) => c.platform)).toEqual([platform]);
      expect(created[0].starts).toBe(1);
    },
  );

  it('starts all four when all four are configured', () => {
    query = { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' };
    render(<MultichatPage />);
    expect(created.map((c) => c.platform).sort())
      .toEqual(['kick', 'tiktok', 'twitch', 'youtube']);
  });

  it('starts nothing on a generator visit', () => {
    render(<MultichatPage />);
    expect(created).toEqual([]);
    expect(startPoller).not.toHaveBeenCalled();
  });
});

describe('unmount and remount cleanup', () => {
  it('stops every connector it started', () => {
    query = { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' };
    const { unmount } = render(<MultichatPage />);
    unmount();
    for (const record of created) expect(record.stops, record.platform).toBe(record.starts);
  });

  it('stops the cosmetics fetcher', () => {
    query = { kick: 'a' };
    const { unmount } = render(<MultichatPage />);
    unmount();
    expect(cosmetics.stops).toBeGreaterThanOrEqual(1);
  });

  it('leaves no timer able to fire after unmount', () => {
    vi.useFakeTimers();
    query = { kick: 'a' };
    const { unmount } = render(<MultichatPage />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Strict Mode leaves one live connector per configured platform', () => {
    query = { kick: 'a', twitch: 'b' };
    render(
      <StrictMode>
        <MultichatPage />
      </StrictMode>,
    );
    for (const platform of ['kick', 'twitch']) {
      const live = forPlatform(platform).filter((r) => r.starts > r.stops);
      expect(live, platform).toHaveLength(1);
    }
  });

  it('Strict Mode plus unmount leaves nothing live', () => {
    query = { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' };
    const { unmount } = render(
      <StrictMode>
        <MultichatPage />
      </StrictMode>,
    );
    unmount();
    expect(created.filter((r) => r.starts > r.stops)).toEqual([]);
  });
});

describe('retired native pin polling', () => {
  it('never starts for current URLs', () => {
    query = { twitch: 'somechannel' };
    window.location.hash = `#twitchConnectionId=${TEST_ID}`;
    render(<MultichatPage />);
    expect(startPoller).not.toHaveBeenCalled();
  });

  it('ignores legacy pin query parameters even with a valid connection fragment', () => {
    query = {
      twitch: 'somechannel',
      showPinEnabled: 'true',
      pinPlatforms: 'twitch',
    };
    window.location.hash = `#twitchConnectionId=${TEST_ID}`;
    render(<MultichatPage />);
    expect(startPoller).not.toHaveBeenCalled();
  });

  it('ignores malformed and stale connection fragments', () => {
    for (const fragment of [
      '#twitchConnectionId=not-a-uuid',
      `#twitchConnectionId=${TEST_ID}`,
    ]) {
      cleanup();
      startPoller.mockClear();
      query = { twitch: 'somechannel', showPinEnabled: 'true', pinPlatforms: 'twitch' };
      window.location.hash = fragment;
      render(<MultichatPage />);
      expect(startPoller).not.toHaveBeenCalled();
    }
  });

  it('does not rewrite a legacy fragment into the query string', () => {
    query = { twitch: 'somechannel', showPinEnabled: 'true', pinPlatforms: 'twitch' };
    window.location.hash = `#twitchConnectionId=${TEST_ID}`;
    render(<MultichatPage />);
    expect(window.location.search).not.toContain('twitchConnectionId');
    expect(replace).not.toHaveBeenCalled();
  });
});
