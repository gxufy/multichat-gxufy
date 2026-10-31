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
    await expect(getGxufyBadges()).resolves.toEqual([
      {
        id: 'supporter',
        title: 'Gxufy Supporter',
        url: '/badges/gxufy/supporter.webp',
        userIds: ['204219574'],
      },
    ]);
  });
});