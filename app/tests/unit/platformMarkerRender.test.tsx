import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceTag, type SourceTagMode } from '@/lib/render';
import type { Platform } from '@/lib/types';

const platforms: Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];
const modes: SourceTagMode[] = ['none', 'dot', 'label', 'icon'];

afterEach(cleanup);

describe('hidden runtime platform marker', () => {
  it.each(platforms)('tags %s rows in every source-tag mode', (platform) => {
    for (const mode of modes) {
      const { container } = render(<div>{sourceTag(platform, mode)}</div>);
      const markers = container.querySelectorAll('[data-chat-platform]');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-chat-platform')).toBe(platform);
      expect((markers[0] as HTMLElement).style.display).toBe('none');
      cleanup();
    }
  });
});
