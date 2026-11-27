import { afterEach, describe, expect, it } from 'vitest';
import { rowSourceTagPart, type SourceTagMode } from '@/lib/renderCore';
import { clearDrawn, drawParts } from '../fixtures/drawParts';
import type { Platform } from '@/lib/types';

const platforms: Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];
const modes: SourceTagMode[] = ['none', 'dot', 'label', 'icon'];

afterEach(clearDrawn);

describe('hidden runtime platform marker', () => {
  it.each(platforms)('tags %s rows in every source-tag mode', (platform) => {
    for (const mode of modes) {
      const { container } = drawParts([rowSourceTagPart(platform, mode)]);
      const markers = container.querySelectorAll('[data-chat-platform]');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-chat-platform')).toBe(platform);
      expect((markers[0] as HTMLElement).style.display).toBe('none');
      clearDrawn();
    }
  });
});
