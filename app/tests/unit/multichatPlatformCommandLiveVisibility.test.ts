import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMultichatCommandRunner,
  type CommandHost,
} from '@/lib/multichatCommandRuntime';
import { resetPlatformChatDomVisibility } from '@/lib/platformChatVisibility';
import type { Platform, UnifiedMessage } from '@/lib/types';

const cases: readonly [Platform, string, string][] = [
  ['kick', 'kickoff', 'kickon'],
  ['twitch', 'twitchoff', 'twitchon'],
  ['youtube', 'youtubeoff', 'youtubeon'],
  ['tiktok', 'tiktokoff', 'tiktokon'],
];

function moderator(text: string, id: string): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId: 'mod-1',
    username: 'somemod',
    color: '#fff',
    badges: [{ type: 'moderator' }],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function mountRows(): Map<Platform, HTMLElement> {
  document.body.innerHTML = '<div id="chat_container"></div>';
  const container = document.getElementById('chat_container')!;
  const rows = new Map<Platform, HTMLElement>();
  for (const platform of cases.map(([candidate]) => candidate)) {
    const row = document.createElement('div');
    row.className = 'gx-message-row';
    row.style.display = 'grid';
    const marker = document.createElement('span');
    marker.setAttribute('data-chat-platform', platform);
    row.appendChild(marker);
    container.appendChild(row);
    rows.set(platform, row);
  }
  return rows;
}

function runner() {
  const platformVisible = vi.fn();
  const host: CommandHost = {
    channels: { kick: 'streamer', twitch: 'streamer', youtube: 'streamer', tiktok: 'streamer' },
    showFloat: vi.fn(),
    removeFloat: vi.fn(),
    removeAllFloats: vi.fn(),
    clearChatMessages: vi.fn(),
    setChatPresentationPaused: vi.fn(),
    toggleChatPresentationPaused: vi.fn(),
    mountFloat: vi.fn(),
    createElement: (tag) => document.createElement(tag),
    setChatVisible: vi.fn(),
    setPlatformChatVisible: platformVisible,
    setSharedChatVisible: vi.fn(),
    setCounterBackground: vi.fn(),
    reload: vi.fn(),
    refreshEmotes: vi.fn(async () => {}),
    findEmoteUrl: vi.fn(() => null),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    readReloadStamp: vi.fn(() => null),
    writeReloadStamp: vi.fn(),
    now: vi.fn(() => 1_000),
  };
  return { platformVisible, runner: createMultichatCommandRunner(host) };
}

afterEach(() => {
  resetPlatformChatDomVisibility();
  document.body.innerHTML = '';
});

describe('live platform on/off commands', () => {
  it.each(cases)('%s off removes its current live rows and on restores DOM visibility', (platform, off, on) => {
    const rows = mountRows();
    const harness = runner();

    expect(harness.runner.handle(moderator(`!multichat ${off}`, `${platform}-off`))?.name).toBe(off);
    expect(harness.platformVisible).toHaveBeenLastCalledWith(platform, false);
    expect(rows.get(platform)!.style.display).toBe('none');

    for (const [other] of cases) {
      if (other !== platform) expect(rows.get(other)!.style.display).toBe('grid');
    }

    expect(harness.runner.handle(moderator(`!multichat ${on}`, `${platform}-on`))?.name).toBe(on);
    expect(harness.platformVisible).toHaveBeenLastCalledWith(platform, true);
    expect(rows.get(platform)!.style.display).toBe('grid');
  });
});
