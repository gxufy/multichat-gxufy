import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MultichatPage from '@/pages/multichat';

let query: Record<string, string> = {};
const connectorOptions = vi.hoisted(() => ({
  kick: null as any,
  twitch: null as any,
  youtube: null as any,
  tiktok: null as any,
}));
const usageReporter = vi.hoisted(() => ({
  resolved: vi.fn(),
  stop: vi.fn(),
}));
const createUsageReporter = vi.hoisted(() => vi.fn(() => usageReporter));

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query, replace: vi.fn() }),
}));
vi.mock('../../src/components/overlay/ChatOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="usage-overlay" />,
  FONT_FAMILIES: {},
}));
vi.mock('../../src/components/classic/ClassicGenerator', () => ({
  __esModule: true,
  default: () => <div />,
}));
vi.mock('../../src/lib/overlayUsage', () => ({
  createOverlayUsageReporter: createUsageReporter,
}));
vi.mock('../../src/lib/connectors/kick', () => ({
  createKickConnector: (options: any) => {
    connectorOptions.kick = options;
    return { start() {}, stop() {} };
  },
}));
vi.mock('../../src/lib/connectors/twitch', () => ({
  createTwitchConnector: (options: any) => {
    connectorOptions.twitch = options;
    return { start() {}, stop() {} };
  },
}));
vi.mock('../../src/lib/connectors/youtube', () => ({
  createYouTubeConnector: (options: any) => {
    connectorOptions.youtube = options;
    return { start() {}, stop() {} };
  },
}));
vi.mock('../../src/lib/connectors/tiktok', () => ({
  createTikTokConnector: (options: any) => {
    connectorOptions.tiktok = options;
    return { start() {}, stop() {} };
  },
}));
vi.mock('../../src/lib/cosmetics', () => ({
  createCosmeticsFetcher: () => ({ want() {}, stop() {} }),
}));
vi.mock('../../src/lib/twitchPinPoller', () => ({
  startTwitchPinPoller: () => () => {},
}));

describe('MultiChat overlay usage wiring', () => {
  beforeEach(() => {
    query = {
      kick: 'Kick-User',
      twitch: 'Twitch_User',
      youtube: 'Agent00',
      tiktok: 'tiktok',
      sevenTVEmotesEnabled: 'false',
      sevenTVCosmeticsEnabled: 'false',
    };
    Object.assign(connectorOptions, { kick: null, twitch: null, youtube: null, tiktok: null });
    createUsageReporter.mockClear();
    usageReporter.resolved.mockClear();
    usageReporter.stop.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('marks only provider-confirmed canonical identities as resolved', async () => {
    const view = render(<MultichatPage />);
    await waitFor(() => expect(connectorOptions.tiktok).not.toBeNull());

    expect(createUsageReporter).toHaveBeenCalledWith(['kick', 'twitch', 'youtube', 'tiktok']);
    expect(usageReporter.resolved).not.toHaveBeenCalled();

    act(() => {
      connectorOptions.kick.onStatus('error');
      connectorOptions.twitch.onStatus('connected');
      connectorOptions.youtube.onStatus('connecting');
      connectorOptions.tiktok.onStatus('connecting');
    });
    expect(usageReporter.resolved).not.toHaveBeenCalled();

    await act(async () => {
      await connectorOptions.kick.onChannelInfo({ slug: 'resolved-kick' });
      connectorOptions.kick.onStatus('connected');
      connectorOptions.twitch.onRoomId('1234');
      await connectorOptions.youtube.onChannelInfo({ channelId: 'UC123', videoId: 'video' });
      connectorOptions.tiktok.onStatus('connected');
    });

    expect(usageReporter.resolved.mock.calls).toEqual([
      ['kick', 'resolved-kick'],
      ['twitch', 'Twitch_User'],
      ['youtube', 'Agent00'],
      ['tiktok', 'tiktok'],
    ]);

    view.unmount();
    expect(usageReporter.stop).toHaveBeenCalledTimes(1);
  });
});
