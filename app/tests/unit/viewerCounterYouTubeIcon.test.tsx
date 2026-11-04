import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ViewerCounterDisplay from '@/components/overlay/ViewerCounterDisplay';
import { TWITCH_PLATFORM_ICON_SRC } from '@/lib/platformAssets';
import { DEFAULT_STYLE } from '@/lib/viewerCounterConfig';

afterEach(cleanup);

describe('viewer counter YouTube icon', () => {
  it('renders the isolated full YouTube logo asset instead of an inline path', () => {
    const { container } = render(
      <ViewerCounterDisplay
        statuses={{ youtube: { state: 'live', viewers: 1234 } }}
        style={{ ...DEFAULT_STYLE, combined: false, icons: true }}
      />,
    );

    const icon = container.querySelector<HTMLImageElement>('img[src="/platform-youtube.svg"]');
    expect(icon).not.toBeNull();
    expect(icon?.draggable).toBe(false);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('uses the shared Twitch artwork source used by MultiChat', () => {
    const { container } = render(
      <ViewerCounterDisplay
        statuses={{ twitch: { state: 'live', viewers: 1234 } }}
        style={{ ...DEFAULT_STYLE, combined: false, icons: true }}
      />,
    );

    expect(
      container.querySelector<HTMLImageElement>(`img[src="${TWITCH_PLATFORM_ICON_SRC}"]`),
    ).not.toBeNull();
  });
});
