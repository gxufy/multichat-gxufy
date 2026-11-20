import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  getGxufyBadges,
} from '@/lib/server/gxufyBadges';

describe('GXUFY badge registry', () => {
  it('returns the first-party supporter badge', async () => {
    const [badge] = await getGxufyBadges(null);
    expect(badge).toMatchObject({
      id: 'supporter',
      title: 'FlossChat Supporter',
      url: '/badges/gxufy/supporter-hand.webp',
      host: '/badges/gxufy/supporter',
      userIds: ['204219574'],
    });
    /* Same sized set as Limerino: 18/36/54/72, animated WebP + still PNG. */
    expect(badge!.files!.map((file) => `${file.name} ${file.width}`)).toEqual([
      '1x.webp 18', '1x.png 18', '2x.webp 36', '2x.png 36',
      '3x.webp 54', '3x.png 54', '4x.webp 72', '4x.png 72',
    ]);
  });
});