import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_BADGE_PROVIDERS,
  badgeProviderFromType,
  normalizeBadgeLayout,
  parseBadgeLayout,
  serializeBadgeLayout,
} from '@/lib/badgeLayout';

describe('badge order and visibility', () => {
  it('defaults to every provider visible in canonical order', () => {
    const layout = parseBadgeLayout('');
    expect(layout.map((entry) => entry.provider)).toEqual(MULTICHAT_BADGE_PROVIDERS);
    expect(layout.every((entry) => entry.visible)).toBe(true);
    expect(serializeBadgeLayout(layout)).toBe('');
  });

  it('preserves order and hidden providers', () => {
    const layout = parseBadgeLayout('7tv,!ffz,platform');
    expect(layout.slice(0, 3)).toEqual([
      { provider: '7tv', visible: true },
      { provider: 'ffz', visible: false },
      { provider: 'platform', visible: true },
    ]);
    expect(layout).toHaveLength(MULTICHAT_BADGE_PROVIDERS.length);
    expect(normalizeBadgeLayout('7tv,!ffz,platform')).toContain('7tv,!ffz,platform');
  });

  it('maps badge types to provider groups', () => {
    expect(badgeProviderFromType('moderator')).toBe('platform');
    expect(badgeProviderFromType('community:bttv:supporter')).toBe('bttv');
    expect(badgeProviderFromType('community:custom-homies:founder')).toBe('homies');
    expect(badgeProviderFromType('community:purpletv:donor')).toBe('purpletv');
    expect(badgeProviderFromType('community:ffzap:supporter')).toBe('ffzap');
    expect(badgeProviderFromType('community:jilchat:carrot')).toBe('jilchat');
  });
});
