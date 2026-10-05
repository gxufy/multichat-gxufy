import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMessageText } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';

function message(platform: UnifiedMessage['platform'], text: string, ranges: Array<[number, number]>): UnifiedMessage {
  return {
    platform,
    id: 'spacing-test',
    senderId: 'user-1',
    username: 'user',
    color: '#ffffff',
    badges: [],
    text,
    emotes: ranges.map(([begin, end], index) => ({
      begin,
      end,
      text: text.slice(begin, end),
      url: `https://cdn.example/emote-${index}.webp`,
    })),
    timestamp: 1,
    kind: 'chat',
  };
}

describe('native emote spacing', () => {
  it.each(['twitch', 'kick', 'youtube', 'tiktok'] as const)(
    'marks %s native emotes without changing their shared emote class',
    (platform) => {
      const { container } = render(
        <>{renderMessageText(message(platform, 'A', [[0, 1]]), [])}</>,
      );
      const image = container.querySelector('img')!;
      expect(image.classList).toContain('ck-emote');
      expect(image.classList).toContain('ck-native-emote');
      expect(image.classList).toContain(`ck-native-${platform}`);
    },
  );

  it.each(['kick', 'youtube'] as const)('adds one space between touching %s native emotes', (platform) => {
    const { container } = render(<>{renderMessageText(message(platform, 'AB', [[0, 1], [1, 2]]), [])}</>);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.textContent).toBe(' ');
  });

  it('leaves touching Twitch native emotes unchanged', () => {
    const { container } = render(<>{renderMessageText(message('twitch', 'AB', [[0, 1], [1, 2]]), [])}</>);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.textContent).toBe('');
  });

  it.each(['kick', 'youtube'] as const)('does not double existing %s whitespace', (platform) => {
    const { container } = render(<>{renderMessageText(message(platform, 'A B', [[0, 1], [2, 3]]), [])}</>);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.textContent).toBe(' ');
  });
});
