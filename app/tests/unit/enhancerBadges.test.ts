import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  parseEnhancerAggregate,
} from '@/lib/server/enhancerBadges';

describe('Enhancer badge aggregate parser', () => {
  it('maps Twitch ids to active badges and sorts them by provider priority', () => {
    const parsed = parseEnhancerAggregate({
      channelId: null,
      platform: 'TWITCH',
      cursor: '1-1',

      accounts: [
        {
          accountId: 'account-1',
          externalId: '123',
          badgesIds: [
            'tester',
            'patron',
          ],
        },
        {
          accountId: 'account-2',
          externalId: '456',
          badgesIds: [
            'tester',
          ],
        },
        {
          accountId: 'bad-user',
          externalId: 'not-a-twitch-id',
          badgesIds: [
            'patron',
          ],
        },
      ],

      badges: [
        {
          badgeId: 'tester',
          name: 'Enhancer Tester',
          priority: 997,
          sources: {
            '18x18':
              'https://cdn.enhancer.at/badge/tester/18.webp',
            '72x72':
              'https://cdn.enhancer.at/badge/tester/72.webp',
          },
        },
        {
          badgeId: 'patron',
          name: 'Patron',
          priority: 0,
          sources: {
            '36x36':
              'https://cdn.enhancer.at/badge/patron/36.webp',
            '72x72':
              'https://cdn.enhancer.at/badge/patron/72.webp',
          },
        },
        {
          badgeId: 'unsafe',
          name: 'Unsafe',
          priority: 1,
          sources: {
            '72x72':
              'https://evil.example/unsafe.webp',
          },
        },
      ],
    });

    expect(parsed).toEqual([
      {
        id: 'patron',
        title: 'Patron',
        url:
          'https://cdn.enhancer.at/badge/patron/72.webp',
        users: ['123'],
        priority: 0,
      },
      {
        id: 'tester',
        title: 'Enhancer Tester',
        url:
          'https://cdn.enhancer.at/badge/tester/72.webp',
        users: ['123', '456'],
        priority: 997,
      },
    ]);
  });

  it('rejects a malformed or non-Twitch aggregate', () => {
    expect(
      parseEnhancerAggregate(null),
    ).toBeNull();

    expect(
      parseEnhancerAggregate({
        platform: 'KICK',
        accounts: [],
        badges: [],
      }),
    ).toBeNull();

    expect(
      parseEnhancerAggregate({
        platform: 'TWITCH',
        accounts: {},
        badges: [],
      }),
    ).toBeNull();
  });
});