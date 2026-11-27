import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  getGxufyBadges,
  heldBadgeIds,
  shownBadgeId,
} from '@/lib/server/gxufyBadges';

describe('GXUFY badge registry', () => {
  it('lists Owner, Founder and the three tiers, all the owner\'s hand art, in chat order', async () => {
    const badges = await getGxufyBadges(null);
    expect(badges.map((badge) => [badge.id, badge.title, badge.url, badge.host, badge.userIds])).toEqual([
      ['owner', 'Owner', '/badges/gxufy/owner-hand.webp', '/badges/gxufy/owner', ['204219574']],
      ['founder', 'Founder', '/badges/gxufy/founder-hand.webp', '/badges/gxufy/founder', []],
      ['top-suvy', 'Top Suvy', '/badges/gxufy/top-suvy-hand.webp', '/badges/gxufy/top-suvy', []],
      ['suvy', 'Suvy', '/badges/gxufy/suvy-hand.webp', '/badges/gxufy/suvy', []],
      ['supporter', 'Sanctioned', '/badges/gxufy/supporter-hand.webp', '/badges/gxufy/supporter', []],
    ]);
    /* Same sized set as Limerino: 18/36/54/72, animated WebP + still PNG. */
    for (const badge of badges) {
      expect(badge.files!.map((file) => `${file.name} ${file.width}`)).toEqual([
        '1x.webp 18', '1x.png 18', '2x.webp 36', '2x.png 36',
        '3x.webp 54', '3x.png 54', '4x.webp 72', '4x.png 72',
      ]);
    }
  });

  it('a tier keeps the tiers below it; one shows, by default Owner, then the tier, then Founder', () => {
    expect(heldBadgeIds({ owner: false, tier: null, founder: false })).toEqual([]);
    expect(heldBadgeIds({ owner: false, tier: 'supporter', founder: true })).toEqual(['supporter', 'founder']);
    expect(heldBadgeIds({ owner: false, tier: 'suvy', founder: false })).toEqual(['suvy', 'supporter']);
    expect(heldBadgeIds({ owner: true, tier: 'top-suvy', founder: true }))
      .toEqual(['owner', 'top-suvy', 'founder', 'suvy', 'supporter']);
    const held = heldBadgeIds({ owner: false, tier: 'top-suvy', founder: true });
    expect(shownBadgeId(held, undefined, false)).toBe('top-suvy');
    expect(shownBadgeId(held, 'suvy', false)).toBe('suvy');
    expect(shownBadgeId(held, 'owner', false)).toBe('top-suvy');
    expect(shownBadgeId(held, 'suvy', true)).toBeNull();
  });
});
