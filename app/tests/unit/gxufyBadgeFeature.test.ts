import { describe, expect, it } from 'vitest';
import { partsToHtml } from '@/lib/render/elementTree';
import { badgeParts } from '@/lib/renderCore';
import type { UnifiedMessage } from '@/lib/types';

const message = (badges: UnifiedMessage['badges']): UnifiedMessage => ({
  platform: 'twitch', id: 'm', senderId: '1', username: 'u', color: '', badges,
  text: 'hi', emotes: [], timestamp: 1, kind: 'chat',
});

describe('Gxufy supporter badge slot', () => {
  it('is marked so it fills the same square as other badges', () => {
    const html = partsToHtml(badgeParts(message([
      { type: 'community:gxufy:supporter', title: 'Gxufy Supporter', url: '/badges/gxufy/supporter-hand.webp' },
      { type: 'community:jilchat:x', title: 'JilChat', url: 'https://example.com/j.png' },
    ]), []));
    expect(html).toMatch(/class="ck-badge-img ck-badge-feature"[^>]*supporter-hand|supporter-hand[^>]*class="ck-badge-img ck-badge-feature"/);
    expect(html).toMatch(/j\.png/);
    expect((html.match(/ck-badge-feature/g) ?? []).length).toBe(1);
  });
});
