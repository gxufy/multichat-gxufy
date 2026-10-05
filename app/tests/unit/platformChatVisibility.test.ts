import { afterEach, describe, expect, it } from 'vitest';
import {
  purgePlatformChat,
  resetPlatformChatDomVisibility,
  setPlatformChatDomVisible,
} from '@/lib/platformChatVisibility';
import type { Platform } from '@/lib/types';

type Message = { id: string; platform: Platform };

const allPlatforms: Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];

function messages(prefix: string): Message[] {
  return allPlatforms.map((platform) => ({ id: `${prefix}-${platform}`, platform }));
}

function mountRows(): Map<Platform, HTMLElement> {
  document.body.innerHTML = '<div id="chat_container"></div>';
  const container = document.getElementById('chat_container')!;
  const rows = new Map<Platform, HTMLElement>();
  for (const platform of allPlatforms) {
    const row = document.createElement('div');
    row.className = 'gx-message-row';
    row.style.display = 'grid';
    const marker = document.createElement('span');
    marker.setAttribute('data-chat-platform', platform);
    marker.style.display = 'none';
    row.appendChild(marker);
    container.appendChild(row);
    rows.set(platform, row);
  }
  return rows;
}

afterEach(() => {
  resetPlatformChatDomVisibility();
  document.body.innerHTML = '';
});

describe('platform chat visibility purge', () => {
  it.each(allPlatforms)('removes %s from backing, pending, and already-presented chat', (platform) => {
    const result = purgePlatformChat({
      backing: messages('backing'),
      pending: messages('pending'),
      presented: messages('presented'),
    }, platform);

    for (const store of [result.backing, result.pending, result.presented]) {
      expect(store.some((message) => message.platform === platform)).toBe(false);
      expect(store).toHaveLength(allPlatforms.length - 1);
      for (const other of allPlatforms.filter((candidate) => candidate !== platform)) {
        expect(store.some((message) => message.platform === other)).toBe(true);
      }
    }
  });

  it('does not mutate the input arrays', () => {
    const backing = messages('backing');
    const pending = messages('pending');
    const presented = messages('presented');

    purgePlatformChat({ backing, pending, presented }, 'youtube');

    expect(backing).toHaveLength(4);
    expect(pending).toHaveLength(4);
    expect(presented).toHaveLength(4);
  });
});

describe('live platform DOM visibility guard', () => {
  it.each(allPlatforms)('hides and restores already-rendered %s rows immediately', (platform) => {
    const rows = mountRows();

    setPlatformChatDomVisible(platform, false);

    for (const candidate of allPlatforms) {
      expect(rows.get(candidate)!.style.display).toBe(candidate === platform ? 'none' : 'grid');
    }

    setPlatformChatDomVisible(platform, true);
    expect(rows.get(platform)!.style.display).toBe('grid');
  });

  it('re-hides a matching row if React writes its display style before reconciliation finishes', async () => {
    const rows = mountRows();
    const youtube = rows.get('youtube')!;
    setPlatformChatDomVisible('youtube', false);
    expect(youtube.style.display).toBe('none');

    youtube.style.display = 'grid';
    await Promise.resolve();
    await Promise.resolve();

    expect(youtube.style.display).toBe('none');
  });

  it('hides a matching row inserted after the off command', async () => {
    mountRows();
    setPlatformChatDomVisible('youtube', false);

    const late = document.createElement('div');
    late.className = 'gx-message-row';
    late.style.display = 'grid';
    const marker = document.createElement('span');
    marker.setAttribute('data-chat-platform', 'youtube');
    late.appendChild(marker);
    document.getElementById('chat_container')!.appendChild(late);

    await Promise.resolve();
    await Promise.resolve();

    expect(late.style.display).toBe('none');
  });
});
