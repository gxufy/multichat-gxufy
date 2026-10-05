import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredStartupDebugPlatforms,
  ensureStartupDebugPanel,
  formatStartupDebugDelta,
  reportStartupAcceptedMessage,
  resetStartupDebugForTests,
  startupDebugEnabled,
  startupDebugOverlayStartedAt,
} from '@/lib/startupDebug';
import type { Platform, UnifiedMessage } from '@/lib/types';

function message(platform: Platform, timestamp: number, id = '1'): UnifiedMessage {
  return {
    platform,
    id,
    senderId: `${platform}-user`,
    username: 'viewer',
    color: '',
    badges: [],
    text: 'hello',
    emotes: [],
    timestamp,
    kind: 'chat',
  };
}

beforeEach(() => {
  resetStartupDebugForTests();
  window.history.replaceState({}, '', '/multichat');
});

afterEach(() => {
  resetStartupDebugForTests();
  vi.restoreAllMocks();
});

describe('startup debug mode', () => {
  it('is opt-in and recognizes every configured platform', () => {
    expect(startupDebugEnabled('?startupDebug=1')).toBe(true);
    expect(startupDebugEnabled('?startupDebug=true')).toBe(true);
    expect(startupDebugEnabled('?startupDebug=0')).toBe(false);
    expect(configuredStartupDebugPlatforms(
      '?channel=kickname&twitch=twitchname&youtube=ytname&tiktok=ttname&startupDebug=1',
    )).toEqual(['kick', 'twitch', 'youtube', 'tiktok']);
  });

  it('renders waiting rows, then records only the first accepted chat per platform', () => {
    window.history.replaceState({}, '', '/multichat?youtube=Kozwrld&twitch=Kozwrld&startupDebug=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const startedAt = startupDebugOverlayStartedAt();

    const panel = ensureStartupDebugPanel();
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('YouTube: waiting for first accepted chat...');
    expect(panel?.textContent).toContain('Twitch: waiting for first accepted chat...');

    reportStartupAcceptedMessage(message('youtube', startedAt + 250, 'first'));
    reportStartupAcceptedMessage(message('youtube', startedAt + 900, 'second'));

    expect(panel?.textContent).toContain('YouTube:');
    expect(panel?.textContent).toContain('(+0.250s)');
    expect(panel?.textContent).not.toContain('(+0.900s)');
    expect(panel?.textContent).toContain('Twitch: waiting for first accepted chat...');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('marks a negative provider timestamp as a possible backlog regression', () => {
    window.history.replaceState({}, '', '/multichat?kick=kozwrld&startupDebug=1');
    const startedAt = startupDebugOverlayStartedAt();
    ensureStartupDebugPanel();

    reportStartupAcceptedMessage(message('kick', startedAt - 1_500));

    expect(document.getElementById('multichat-startup-debug')?.textContent).toContain('(-1.500s)');
    expect(document.getElementById('multichat-startup-debug')?.textContent).toContain('BACKLOG?');
  });

  it('does not record system events or unconfigured platforms', () => {
    window.history.replaceState({}, '', '/multichat?youtube=kozwrld&startupDebug=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const startedAt = startupDebugOverlayStartedAt();
    const system = { ...message('youtube', startedAt + 100), kind: 'system' as const };

    ensureStartupDebugPanel();
    reportStartupAcceptedMessage(system);
    reportStartupAcceptedMessage(message('kick', startedAt + 200));

    expect(info).not.toHaveBeenCalled();
    expect(document.getElementById('multichat-startup-debug')?.textContent)
      .toContain('YouTube: waiting for first accepted chat...');
  });

  it('formats signed second offsets consistently', () => {
    expect(formatStartupDebugDelta(1234)).toBe('+1.234s');
    expect(formatStartupDebugDelta(-45)).toBe('-0.045s');
  });
});
