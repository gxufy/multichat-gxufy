import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  badgeParts,
} from '@/lib/renderCore';

import { clearDrawn, drawParts } from '../fixtures/drawParts';

import type {
  UnifiedMessage,
} from '@/lib/types';

afterEach(clearDrawn);

function message(): UnifiedMessage {
  return {
    platform: 'twitch',
    id: 'gxufy-render-test',
    senderId: '204219574',
    username: 'Gxufy',
    color: '#9146ff',
    badges: [{
      type: 'community:gxufy:supporter',
      title: 'FlossChat Supporter',
      url: '/badges/gxufy/supporter-hand.webp',
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

    const { container } = drawParts(badgeParts(msg, []));

    const images =
      container.querySelectorAll('img.ck-badge-img');

    expect(images).toHaveLength(1);

    const image = images[0]!;

    expect(image.getAttribute('src')).toBe(
      '/badges/gxufy/supporter-hand.webp',
    );

    expect(image.getAttribute('alt')).toBe(
      'FlossChat Supporter',
    );

    expect(image.getAttribute('title')).toBe(
      'FlossChat Supporter',
    );
  });
});