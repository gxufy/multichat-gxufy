import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  cleanup,
  render,
} from '@testing-library/react';

import {
  Fragment,
} from 'react';

import {
  renderBadges,
} from '@/lib/renderCore';

import type {
  UnifiedMessage,
} from '@/lib/types';

afterEach(cleanup);

const CASES = [
  [0, 0],
  [1, 1],
  [3, 3],
  [6, 6],
  [12, 12],
  [24, 24],
  [36, 36],
  [48, 48],
] as const;

function message(
  months: number,
  tier: number,
): UnifiedMessage {
  const title =
    months >= 1
      ? `Previews Subscriber  ${months}mo`
      : 'Previews Subscriber';

  return {
    platform: 'twitch',
    id: `previews-${tier}`,
    senderId: 'previews-render-test',
    username: 'PreviewsUser',
    color: '#9146ff',
    badges: [{
      type: `community:previews:subscriber-${tier}`,
      title,
      url: `/badges/previews/badge_m${tier}.webp`,
    }],
    text: 'hello',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

describe('Previews renderer parity', () => {
  it.each(CASES)(
    'renders the %i month tier with its original badge art',
    (months, tier) => {
      const msg = message(months, tier);

      const { container } = render(
        <Fragment>
          {renderBadges(msg, [])}
        </Fragment>,
      );

      const images =
        container.querySelectorAll('img.ck-badge-img');

      expect(images).toHaveLength(1);

      const image = images[0]!;

      expect(image.getAttribute('src')).toBe(
        `/badges/previews/badge_m${tier}.webp`,
      );

      expect(image.getAttribute('alt')).toBe(
        months >= 1
          ? `Previews Subscriber  ${months}mo`
          : 'Previews Subscriber',
      );

      expect(image.getAttribute('title')).toBe(
        months >= 1
          ? `Previews Subscriber  ${months}mo`
          : 'Previews Subscriber',
      );

      expect(image.classList.contains('ck-badge-img'))
        .toBe(true);
    },
  );
});