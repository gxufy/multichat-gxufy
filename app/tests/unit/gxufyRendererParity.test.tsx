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

function message(): UnifiedMessage {
  return {
    platform: 'twitch',
    id: 'gxufy-render-test',
    senderId: '204219574',
    username: 'Gxufy',
    color: '#9146ff',
    badges: [{
      type: 'community:gxufy:supporter',
      title: 'Gxufy Supporter',
      url: '/badges/gxufy/supporter.webp',
    }],
    text: 'hello',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

describe('GXUFY renderer parity', () => {
  it('renders the animated supporter badge with the correct metadata', () => {
    const msg = message();

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
      '/badges/gxufy/supporter.webp',
    );

    expect(image.getAttribute('alt')).toBe(
      'Gxufy Supporter',
    );

    expect(image.getAttribute('title')).toBe(
      'Gxufy Supporter',
    );
  });
});